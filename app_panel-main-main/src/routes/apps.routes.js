const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const { pool } = require("../config/db");
const { authRequired, isManagerRole, isSuperAdmin } = require("../middlewares/auth");
const { probeHttpUrl } = require("../utils/httpProbe");
const { requestExternalUrl, requestExternalFormData } = require("../utils/externalApi");
const { buildFormDataFromRequest } = require("../utils/formDataProxy");
const multer = require("multer");
const {
  normalizeApiBaseUrl,
  buildAppApiEndpoints,
  joinApiPath
} = require("../utils/appApi");
const { buildPanelHeaders, resolvePanelApiKey } = require("../utils/panelAuth");
const { hasRevenueCatConfig } = require("../utils/revenueCatConfig");
const {
  getOverviewMetrics,
  getChartData,
  getRevenueSummary,
  getSubscriptionFeed,
  getCustomerDetails
} = require("../utils/revenuecatApi");
const { resolveAppUserForRcCustomer } = require("../utils/revenuecatUserResolve");
const { rcLog, isRevenueCatDebugEnabled } = require("../utils/revenueCatLogger");
const { resolveRevenueCatProjectId } = require("../utils/revenueCatConfig");
const env = require("../config/env");

const router = express.Router();
let ensuredAppColumns = false;
let cachedMindcoachTrExplanations = null;

const panelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 160 * 1024 * 1024 }
});

function parseMultipart(req, res, next) {
  if (!req.is("multipart/form-data")) return next();
  panelUpload.any()(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ ok: false, message: "Dosya boyutu limiti asildi." });
    }
    return res.status(400).json({ ok: false, message: err.message || "Yukleme hatasi." });
  });
}

const APP_SELECT_FIELDS = `
  id, app_name AS appName, bundle_id AS bundleId, icon_url AS iconUrl,
  api_base_url AS apiBaseUrl, panel_slug AS panelSlug, panel_api_key AS panelApiKey,
  revenuecat_project_id AS revenuecatProjectId,
  analyse_api_url AS analyseApiUrl, health_api_url AS healthApiUrl,
  users_api_url AS usersApiUrl,
  latest_version AS latestVersion, status
`;

function normalizeOptionalUrl(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeOptionalSlug(value) {
  if (value == null) return null;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizePanelApiKeyInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeRevenueCatProjectIdInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function explanationCamelToSnake(key) {
  if (!key || !key.startsWith("explanation")) return null;
  const body = key.slice("explanation".length);
  if (!body) return null;
  const snake = body
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-zA-Z])(\d+)/g, "$1_$2")
    .toLowerCase();
  return `explanation_${snake}`;
}

function enrichMindcoachExplanationTexts(body) {
  const arbFallback = loadMindcoachTrExplanations();
  const payload = body.data && typeof body.data === "object" ? body.data : body;
  const explanationsByJob = payload?.explanationsByJob || {};
  const backendTexts = payload?.explanationTextsByKey || {};
  const backendWithText = payload?.explanationsWithTextByJob || {};

  const scoped = { ...backendTexts };
  const explanationsWithTextByJob = {};

  for (const [job, keys] of Object.entries(explanationsByJob)) {
    if (!Array.isArray(keys)) continue;

    const backendItems = backendWithText[job];
    if (Array.isArray(backendItems) && backendItems.length) {
      explanationsWithTextByJob[job] = backendItems.map((item) => {
        const key = item?.key || "";
        const text =
          (typeof item?.text === "string" && item.text.trim()) ||
          scoped[key] ||
          arbFallback[key] ||
          "";
        if (key && text) scoped[key] = text;
        return { key, text };
      });
      continue;
    }

    explanationsWithTextByJob[job] = keys.map((key) => {
      const text = scoped[key] || arbFallback[key] || "";
      if (text) scoped[key] = text;
      return { key, text };
    });
  }

  if (body.data && typeof body.data === "object") {
    body.data.explanationTextsByKey = scoped;
    body.data.explanationsWithTextByJob = explanationsWithTextByJob;
  } else if (typeof body === "object" && body) {
    body.explanationTextsByKey = scoped;
    body.explanationsWithTextByJob = explanationsWithTextByJob;
  }

  return body;
}

function loadMindcoachTrExplanations() {
  if (cachedMindcoachTrExplanations) return cachedMindcoachTrExplanations;
  try {
    const filePath = path.join(__dirname, "../../mindcoach/lib/l10n/app_tr.arb");
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    const out = {};
    for (const [key, value] of Object.entries(json)) {
      if (!key.startsWith("explanation") || key.startsWith("@")) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      const snake = explanationCamelToSnake(key);
      if (!snake) continue;
      out[snake] = value.trim();
    }
    cachedMindcoachTrExplanations = out;
    return out;
  } catch (_err) {
    cachedMindcoachTrExplanations = {};
    return cachedMindcoachTrExplanations;
  }
}

function assertHttpUrl(value, label) {
  if (!value) return null;
  if (!normalizeApiBaseUrl(value)) {
    return `${label} gecerli bir http(s) URL olmalidir.`;
  }
  return null;
}

async function ensureAppColumns() {
  if (ensuredAppColumns) return;

  const statements = [
    "ALTER TABLE applications ADD COLUMN analyse_api_url VARCHAR(600) DEFAULT NULL AFTER icon_url",
    "ALTER TABLE applications ADD COLUMN health_api_url VARCHAR(600) DEFAULT NULL AFTER analyse_api_url",
    "ALTER TABLE applications ADD COLUMN users_api_url VARCHAR(600) DEFAULT NULL AFTER health_api_url",
    "ALTER TABLE applications ADD COLUMN api_base_url VARCHAR(600) DEFAULT NULL AFTER icon_url",
    "ALTER TABLE applications ADD COLUMN panel_slug VARCHAR(64) DEFAULT NULL AFTER api_base_url",
    "ALTER TABLE applications ADD COLUMN panel_api_key VARCHAR(255) DEFAULT NULL AFTER panel_slug",
    "ALTER TABLE applications ADD COLUMN revenuecat_project_id VARCHAR(64) DEFAULT NULL AFTER panel_api_key"
  ];

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (error) {
      if (!["ER_DUP_FIELDNAME", "ER_NO_SUCH_TABLE"].includes(error?.code)) {
        throw error;
      }
    }
  }

  try {
    await pool.query(
      `
      UPDATE applications
      SET api_base_url = ?
      WHERE LOWER(panel_slug) = 'fitgym'
        AND (api_base_url IS NULL OR api_base_url LIKE '%fitness.duyari.com.tr%')
      `,
      ["https://fitgym.fly-work.com/panel/v1"]
    );
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") {
      throw error;
    }
  }

  ensuredAppColumns = true;
}

async function loadAppById(id) {
  const [rows] = await pool.query(
    `SELECT ${APP_SELECT_FIELDS} FROM applications WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function mapAppResponse(app, options = {}) {
  const { includeSecrets = false } = options;
  const endpoints = buildAppApiEndpoints(app);
  const hasPanelApiKey = Boolean(resolvePanelApiKey(app));

  const mapped = {
    ...app,
    apiBaseUrl: endpoints.base,
    apiEndpoints: endpoints,
    hasPanelApiKey,
    hasRevenueCat: hasRevenueCatConfig(app)
  };

  if (!includeSecrets) {
    delete mapped.panelApiKey;
  }

  return mapped;
}

function externalRequestOptions(app, overrides = {}) {
  return {
    headers: buildPanelHeaders(app),
    ...overrides
  };
}

function buildProxyQuery(query, allowedKeys) {
  const params = new URLSearchParams();
  for (const key of allowedKeys) {
    const value = query[key];
    if (value != null && String(value).trim() !== "") {
      params.set(key, String(value).trim());
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function proxyStatusCode(result, fallback = 502) {
  if (result.ok) return 200;
  if (result.statusCode && result.statusCode >= 400) return result.statusCode;
  return fallback;
}

async function proxyExternalWrite(req, res, ctx, { url, method, defaultCreated = 201 }) {
  if (req.is("multipart/form-data")) {
    const formData = buildFormDataFromRequest(req);
    const baseOpts = externalRequestOptions(ctx.app, { method, expectJson: true });
    const result = await requestExternalFormData(url, {
      method,
      formData,
      headers: baseOpts.headers
    });
    const code = result.ok ? result.statusCode || defaultCreated : proxyStatusCode(result);
    return res.status(code).json(result);
  }

  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, {
      method,
      body: req.body,
      expectJson: true
    })
  );
  const code = result.ok ? result.statusCode || defaultCreated : proxyStatusCode(result);
  return res.status(code).json(result);
}

async function loadAppForProxy(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ message: "Gecersiz uygulama id." });
    return null;
  }

  await ensureAppColumns();
  const app = await loadAppById(id);
  if (!app) {
    res.status(404).json({ message: "Uygulama bulunamadi." });
    return null;
  }

  const endpoints = buildAppApiEndpoints(app);
  if (!endpoints.base) {
    res.status(400).json({ message: "API taban URL tanimli degil." });
    return null;
  }

  return { app, endpoints, id };
}

router.get("/", authRequired, async (_, res) => {
  try {
    await ensureAppColumns();

    const [rows] = await pool.query(
      `
      SELECT ${APP_SELECT_FIELDS}
      FROM applications
      ORDER BY app_name ASC
      `
    );

    return res.json({ apps: rows.map((row) => mapAppResponse(row)) });
  } catch (error) {
    return res.status(500).json({ message: "Uygulama listesi alinamadi." });
  }
});

router.get("/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz uygulama id." });
  }

  try {
    await ensureAppColumns();
    const app = await loadAppById(id);
    if (!app) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const includeSecrets = isManagerRole(req.user?.role);
    return res.json({ app: mapAppResponse(app, { includeSecrets }) });
  } catch (error) {
    return res.status(500).json({ message: "Uygulama detayi alinamadi." });
  }
});

router.get("/:id/ping", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz uygulama id." });
  }

  try {
    await ensureAppColumns();
    const app = await loadAppById(id);
    if (!app) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const endpoints = buildAppApiEndpoints(app);
    if (!endpoints.base) {
      return res.status(400).json({ message: "API taban URL tanimli degil." });
    }

    const headers = buildPanelHeaders(app);
    const health = await probeHttpUrl(endpoints.health, { expectJson: false, headers });
    const analyse = await probeHttpUrl(endpoints.analyse, { expectJson: true, headers });
    const users = await probeHttpUrl(endpoints.users, { expectJson: true, headers });

    return res.json({
      appId: id,
      apiBaseUrl: endpoints.base,
      hasPanelApiKey: Boolean(headers["x-panel-api-key"]),
      health,
      analyse,
      users
    });
  } catch (error) {
    return res.status(500).json({ message: "Baglanti testi basarisiz." });
  }
});

router.get("/:id/proxy/health", authRequired, async (req, res) => {
  return proxyGet(req, res, (endpoints) => endpoints.health, { expectJson: false });
});

const PANEL_SLOW_TIMEOUT_MS = 30000;

router.get("/:id/proxy/analyse", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = ctx.endpoints.analyse;
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { expectJson: true, timeoutMs: PANEL_SLOW_TIMEOUT_MS })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/users", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz uygulama id." });
  }

  try {
    await ensureAppColumns();
    const app = await loadAppById(id);
    if (!app) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const endpoints = buildAppApiEndpoints(app);
    if (!endpoints.users) {
      return res.status(400).json({ message: "API taban URL tanimli degil." });
    }

    const params = new URLSearchParams();
    if (req.query.page) params.set("page", String(req.query.page));
    if (req.query.limit) params.set("limit", String(req.query.limit));
    if (req.query.search) params.set("search", String(req.query.search));
    if (req.query.premium) params.set("premium", String(req.query.premium));
    if (req.query.plan) params.set("plan", String(req.query.plan));
    if (req.query.status) params.set("status", String(req.query.status));
    if (req.query.hasTokens) params.set("hasTokens", String(req.query.hasTokens));
    if (req.query.role) params.set("role", String(req.query.role));
    if (req.query.language) params.set("language", String(req.query.language));

    const qs = params.toString();
    const url = qs ? `${endpoints.users}?${qs}` : endpoints.users;

    const result = await requestExternalUrl(url, externalRequestOptions(app, { expectJson: true }));
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({ message: "Kullanici listesi alinamadi." });
  }
});

router.get("/:id/proxy/purchases", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!ctx.endpoints.purchases) {
    return res.status(400).json({ message: "Purchases URL tanimli degil." });
  }

  const qs = buildProxyQuery(req.query, [
    "page",
    "limit",
    "userId",
    "deviceId",
    "search",
    "source",
    "eventType",
    "premiumGranted",
    "status",
    "productId",
    "processed",
    "from",
    "to"
  ]);
  const url = `${ctx.endpoints.purchases}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/notifications", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "isRead", "is_read", "deviceId"]);
  const url = `${ctx.endpoints.notifications || joinApiPath(ctx.endpoints.base, "/notifications")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/purchases/:purchaseId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const purchaseId = encodeURIComponent(String(req.params.purchaseId || "").trim());
  if (!purchaseId) {
    return res.status(400).json({ message: "Gecersiz satin alim id." });
  }

  const url = joinApiPath(ctx.endpoints.base, `/purchases/${purchaseId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

async function loadAppForRevenueCat(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ message: "Gecersiz uygulama id." });
    return null;
  }

  await ensureAppColumns();
  const app = await loadAppById(id);
  if (!app) {
    res.status(404).json({ message: "Uygulama bulunamadi." });
    return null;
  }

  if (!hasRevenueCatConfig(app)) {
    res.status(400).json({
      message:
        "RevenueCat yapilandirmasi eksik. REVENUECAT_API_KEY ve proje id (.env veya uygulama kaydi) gerekli."
    });
    return null;
  }

  return { app, id };
}

router.get("/:id/revenuecat/overview", authRequired, async (req, res) => {
  const ctx = await loadAppForRevenueCat(req, res);
  if (!ctx) return;

  const currency = String(req.query.currency || env.revenuecatDefaultCurrency || "USD").trim();
  const result = await getOverviewMetrics(ctx.app, { currency });
  return res.status(result.ok ? 200 : 502).json(result);
});

router.get("/:id/revenuecat/charts/:chartName", authRequired, async (req, res) => {
  const ctx = await loadAppForRevenueCat(req, res);
  if (!ctx) return;

  const chartName = String(req.params.chartName || "").trim();
  if (!chartName) {
    return res.status(400).json({ message: "Gecersiz chart adi." });
  }

  const currency = String(req.query.currency || env.revenuecatDefaultCurrency || "USD").trim();
  const result = await getChartData(ctx.app, chartName, {
    currency,
    start_date: req.query.start_date,
    end_date: req.query.end_date,
    aggregate: req.query.aggregate
  });
  return res.status(result.ok ? 200 : 502).json(result);
});

router.get("/:id/revenuecat/summary", authRequired, async (req, res) => {
  const ctx = await loadAppForRevenueCat(req, res);
  if (!ctx) return;

  const result = await getRevenueSummary(ctx.app);
  return res.status(result.ok ? 200 : 502).json(result);
});

router.get("/:id/revenuecat/subscriptions-feed", authRequired, async (req, res) => {
  const ctx = await loadAppForRevenueCat(req, res);
  if (!ctx) return;

  const started = Date.now();
  rcLog("route_subscriptions_feed", {
    appId: ctx.id,
    panelSlug: ctx.app?.panelSlug,
    projectId: resolveRevenueCatProjectId(ctx.app),
    query: {
      limit: req.query.limit,
      starting_after: req.query.starting_after,
      search: req.query.search ? "(set)" : null,
      environment: req.query.environment
    },
    userId: req.user?.id
  });

  const result = await getSubscriptionFeed(ctx.app, {
    limit: req.query.limit,
    starting_after: req.query.starting_after,
    search: req.query.search,
    environment: req.query.environment,
    scanPages: req.query.scanPages,
    scanAll: req.query.scanAll,
    customerIds: req.query.customerIds,
    skipMetrics: req.query.skipMetrics,
    includeDebug: isRevenueCatDebugEnabled()
  });

  rcLog("route_subscriptions_feed_done", {
    appId: ctx.id,
    panelSlug: ctx.app?.panelSlug,
    ok: result.ok,
    statusCode: result.statusCode,
    rowCount: result.bodyJson?.rows?.length ?? 0,
    customersFetched: result.bodyJson?.customersFetched ?? 0,
    durationMs: Date.now() - started,
    error: result.error || null
  });

  return res.status(result.ok ? 200 : 502).json(result);
});

router.get("/:id/revenuecat/customers/:customerId/details", authRequired, async (req, res) => {
  const ctx = await loadAppForRevenueCat(req, res);
  if (!ctx) return;

  const customerId = decodeURIComponent(String(req.params.customerId || "").trim());
  if (!customerId) {
    return res.status(400).json({ message: "Gecersiz RevenueCat musteri id." });
  }

  const environment = String(req.query.environment || "production").trim() || "production";
  const rcResult = await getCustomerDetails(ctx.app, customerId, { environment });
  if (!rcResult.ok) {
    return res.status(rcResult.statusCode && rcResult.statusCode < 500 ? rcResult.statusCode : 502).json(rcResult);
  }

  const endpoints = buildAppApiEndpoints(ctx.app);
  let appUser = { matched: false, user: null, details: null, matchStrategy: null };
  if (endpoints.base) {
    appUser = await resolveAppUserForRcCustomer(ctx.app, {
      customerId,
      customer: rcResult.bodyJson?.customer,
      aliasIds: rcResult.bodyJson?.aliasIds || []
    });
  }

  return res.status(200).json({
    ok: true,
    bodyJson: {
      ...rcResult.bodyJson,
      appUser
    }
  });
});

router.get("/:id/proxy/metadata/categories", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = ctx.endpoints.metadataCategories;
  if (!url) {
    return res.status(404).json({ ok: false, error: "Metadata endpoint not configured" });
  }
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/workouts", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, [
    "page",
    "limit",
    "search",
    "status",
    "category",
    "difficulty"
  ]);
  const url = `${ctx.endpoints.workouts}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/workouts", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  return proxyExternalWrite(req, res, ctx, {
    url: ctx.endpoints.workouts,
    method: "POST",
    defaultCreated: 201
  });
});

router.get("/:id/proxy/workouts/:workoutId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const workoutId = encodeURIComponent(String(req.params.workoutId || "").trim());
  if (!workoutId) return res.status(400).json({ message: "Gecersiz antrenman id." });

  const url = joinApiPath(ctx.endpoints.base, `/workouts/${workoutId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/workouts/:workoutId", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const workoutId = encodeURIComponent(String(req.params.workoutId || "").trim());
  if (!workoutId) return res.status(400).json({ message: "Gecersiz antrenman id." });

  const url = joinApiPath(ctx.endpoints.base, `/workouts/${workoutId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/workouts/:workoutId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const workoutId = encodeURIComponent(String(req.params.workoutId || "").trim());
  if (!workoutId) return res.status(400).json({ message: "Gecersiz antrenman id." });

  const url = joinApiPath(ctx.endpoints.base, `/workouts/${workoutId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, {
      method: "DELETE",
      expectJson: true
    })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/media/video", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const url = joinApiPath(ctx.endpoints.base, "/media/video");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.post("/:id/proxy/media/image", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const url = joinApiPath(ctx.endpoints.base, "/media/image");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.get("/:id/proxy/user-workouts", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, [
    "page",
    "limit",
    "userId",
    "workoutId",
    "status",
    "from",
    "to"
  ]);
  const url = `${ctx.endpoints.userWorkouts}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/user-workouts/:sessionId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const sessionId = encodeURIComponent(String(req.params.sessionId || "").trim());
  if (!sessionId) return res.status(400).json({ message: "Gecersiz oturum id." });

  const url = joinApiPath(ctx.endpoints.base, `/user-workouts/${sessionId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/user-workouts/:sessionId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const sessionId = encodeURIComponent(String(req.params.sessionId || "").trim());
  if (!sessionId) return res.status(400).json({ message: "Gecersiz oturum id." });

  const url = joinApiPath(ctx.endpoints.base, `/user-workouts/${sessionId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, {
      method: "PATCH",
      body: req.body,
      expectJson: true
    })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/users/:userId/workouts", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const userId = encodeURIComponent(String(req.params.userId || "").trim());
  if (!userId) return res.status(400).json({ message: "Gecersiz kullanici id." });

  const qs = buildProxyQuery(req.query, ["page", "limit", "status", "from", "to"]);
  const url = `${joinApiPath(ctx.endpoints.base, `/users/${userId}/workouts`)}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/agents/options", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = ctx.endpoints.agentsOptions || joinApiPath(ctx.endpoints.base, "/agents/options");
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  if (result?.ok) {
    const slug = String(ctx.app?.panelSlug || "").toLowerCase();
    if (slug === "mindcoach") {
      result.bodyJson = enrichMindcoachExplanationTexts(result.bodyJson || {});
    }
  }
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/voices", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["gender"]);
  const url = `${joinApiPath(ctx.endpoints.base, "/voices")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/agents", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, [
    "page",
    "limit",
    "search",
    "system",
    "agentType",
    "ownerId",
    "creatorId"
  ]);
  const url = `${ctx.endpoints.agents}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/agents", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  return proxyExternalWrite(req, res, ctx, {
    url: ctx.endpoints.agents,
    method: "POST",
    defaultCreated: 201
  });
});

router.get("/:id/proxy/agents/:agentId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const agentId = encodeURIComponent(String(req.params.agentId || "").trim());
  if (!agentId) return res.status(400).json({ message: "Gecersiz agent id." });

  const url = joinApiPath(ctx.endpoints.base, `/agents/${agentId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/agents/:agentId", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const agentId = encodeURIComponent(String(req.params.agentId || "").trim());
  if (!agentId) return res.status(400).json({ message: "Gecersiz agent id." });

  const url = joinApiPath(ctx.endpoints.base, `/agents/${agentId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/agents/:agentId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const agentId = encodeURIComponent(String(req.params.agentId || "").trim());
  if (!agentId) return res.status(400).json({ message: "Gecersiz agent id." });

  const url = joinApiPath(ctx.endpoints.base, `/agents/${agentId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, {
      method: "DELETE",
      expectJson: true
    })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

const CHATFACE_CDN_BASE = "https://chatface.b-cdn.net";
const CHATFACE_CDN_REFERER = "https://chatface.fly-work.com/";

router.get("/:id/proxy/cdn/personas/images/:filename", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const filename = String(req.params.filename || "").trim();
  if (!/^chatface(?:Female|Male)Avatar\d+(?:Version[23])?\.webp$/i.test(filename)) {
    return res.status(400).send("Gecersiz dosya adi.");
  }

  const cdnUrl = `${CHATFACE_CDN_BASE}/personas/images/${filename}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(cdnUrl, {
      signal: controller.signal,
      headers: { Referer: CHATFACE_CDN_REFERER }
    });
    if (!response.ok) {
      return res.status(response.status === 404 ? 404 : 502).send("CDN gorseli alinamadi.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", response.headers.get("content-type") || "image/webp");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(buffer);
  } catch {
    return res.status(502).send("CDN baglantisi basarisiz.");
  } finally {
    clearTimeout(timer);
  }
});

router.get("/:id/proxy/personas/options", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = ctx.endpoints.personasOptions;
  if (!url) return res.status(400).json({ message: "Personas URL tanimli degil." });

  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/personas", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!ctx.endpoints.personas) {
    return res.status(400).json({ message: "Personas URL tanimli degil." });
  }

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "gender", "active"]);
  const url = `${ctx.endpoints.personas}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/personas", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  return proxyExternalWrite(req, res, ctx, {
    url: ctx.endpoints.personas,
    method: "POST",
    defaultCreated: 201
  });
});

router.get("/:id/proxy/personas/:personaId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const personaId = encodeURIComponent(String(req.params.personaId || "").trim());
  if (!personaId) return res.status(400).json({ message: "Gecersiz karakter id." });

  const url = joinApiPath(ctx.endpoints.base, `/personas/${personaId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/personas/:personaId", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const personaId = encodeURIComponent(String(req.params.personaId || "").trim());
  if (!personaId) return res.status(400).json({ message: "Gecersiz karakter id." });

  const url = joinApiPath(ctx.endpoints.base, `/personas/${personaId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/personas/:personaId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const personaId = encodeURIComponent(String(req.params.personaId || "").trim());
  if (!personaId) return res.status(400).json({ message: "Gecersiz karakter id." });

  const url = joinApiPath(ctx.endpoints.base, `/personas/${personaId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, {
      method: "DELETE",
      expectJson: true
    })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/users/:userId/agents", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const userId = encodeURIComponent(String(req.params.userId || "").trim());
  if (!userId) return res.status(400).json({ message: "Gecersiz kullanici id." });

  const qs = buildProxyQuery(req.query, ["page", "limit", "search"]);
  const url = `${joinApiPath(ctx.endpoints.base, `/users/${userId}/agents`)}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/users/premium-ids", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = joinApiPath(ctx.endpoints.base, "/users/premium-ids");
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/tutors", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!ctx.endpoints.tutors) {
    return res.status(400).json({ message: "Tutors URL tanimli degil." });
  }

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status"]);
  const url = `${ctx.endpoints.tutors}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/tutors", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const url = ctx.endpoints.tutors;
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.get("/:id/proxy/tutors/:tutorId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const tutorId = encodeURIComponent(String(req.params.tutorId || "").trim());
  if (!tutorId) return res.status(400).json({ message: "Gecersiz tutor id." });

  const url = joinApiPath(ctx.endpoints.base, `/tutors/${tutorId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/tutors/:tutorId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const tutorId = encodeURIComponent(String(req.params.tutorId || "").trim());
  if (!tutorId) return res.status(400).json({ message: "Gecersiz tutor id." });

  const url = joinApiPath(ctx.endpoints.base, `/tutors/${tutorId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/tutors/:tutorId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const tutorId = encodeURIComponent(String(req.params.tutorId || "").trim());
  if (!tutorId) return res.status(400).json({ message: "Gecersiz tutor id." });

  const url = joinApiPath(ctx.endpoints.base, `/tutors/${tutorId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/tutors/:tutorId/photo", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const tutorId = encodeURIComponent(String(req.params.tutorId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/tutors/${tutorId}/photo`);
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 200 });
});

router.post("/:id/proxy/tutors/:tutorId/riv", authRequired, parseMultipart, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const tutorId = encodeURIComponent(String(req.params.tutorId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/tutors/${tutorId}/riv`);
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 200 });
});

router.get("/:id/proxy/users/:userId/favorites", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const userId = encodeURIComponent(String(req.params.userId || "").trim());
  if (!userId) return res.status(400).json({ message: "Gecersiz kullanici id." });

  const url = joinApiPath(ctx.endpoints.base, `/users/${userId}/favorites`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/users/:userId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const userId = encodeURIComponent(String(req.params.userId || "").trim());
  if (!userId) return res.status(400).json({ message: "Gecersiz kullanici id." });

  const url = joinApiPath(ctx.endpoints.base, `/users/${userId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/users/:userId/details", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const userId = encodeURIComponent(String(req.params.userId || "").trim());
  if (!userId) return res.status(400).json({ message: "Gecersiz kullanici id." });

  const url = joinApiPath(ctx.endpoints.base, `/users/${userId}/details`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/users/:userId/billing", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const userId = encodeURIComponent(String(req.params.userId || "").trim());
  if (!userId) return res.status(400).json({ message: "Gecersiz kullanici id." });

  const url = joinApiPath(ctx.endpoints.base, `/users/${userId}/billing`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/users/:userId", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const userId = encodeURIComponent(String(req.params.userId || "").trim());

  if (!Number.isInteger(id) || id < 1 || !userId) {
    return res.status(400).json({ message: "Gecersiz istek." });
  }

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  try {
    await ensureAppColumns();
    const app = await loadAppById(id);
    if (!app) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const endpoints = buildAppApiEndpoints(app);
    if (!endpoints.base) {
      return res.status(400).json({ message: "API taban URL tanimli degil." });
    }

    const url = joinApiPath(endpoints.base, `/users/${userId}`);
    const result = await requestExternalUrl(
      url,
      externalRequestOptions(app, {
        method: "PATCH",
        body: req.body,
        expectJson: true
      })
    );

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({ message: "Kullanici guncellenemedi." });
  }
});

router.post("/:id/proxy/users", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }
  if (!ctx.endpoints.users) {
    return res.status(400).json({ message: "Users URL tanimli degil." });
  }
  return proxyExternalWrite(req, res, ctx, {
    url: ctx.endpoints.users,
    method: "POST",
    defaultCreated: 201
  });
});

router.get("/:id/proxy/homework-images", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status"]);
  const url = `${joinApiPath(ctx.endpoints.base, "/homework-images")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/homework-images/:itemId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const itemId = encodeURIComponent(String(req.params.itemId || "").trim());
  if (!itemId) return res.status(400).json({ message: "Gecersiz odev id." });

  const url = joinApiPath(ctx.endpoints.base, `/homework-images/${itemId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/chats", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status"]);
  const url = `${joinApiPath(ctx.endpoints.base, "/chats")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/chats/:chatId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const chatId = encodeURIComponent(String(req.params.chatId || "").trim());
  if (!chatId) return res.status(400).json({ message: "Gecersiz sohbet id." });

  const url = joinApiPath(ctx.endpoints.base, `/chats/${chatId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/translations", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "type", "favorite"]);
  const url = `${ctx.endpoints.translations}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/translations/:translationId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const translationId = encodeURIComponent(String(req.params.translationId || "").trim());
  if (!translationId) return res.status(400).json({ message: "Gecersiz ceviri id." });

  const url = joinApiPath(ctx.endpoints.base, `/translations/${translationId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/logs", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "level"]);
  const url = `${ctx.endpoints.logs}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/options", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = ctx.endpoints.options || joinApiPath(ctx.endpoints.base, "/options");
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/tasks", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "completed", "userId", "date"]);
  const url = `${ctx.endpoints.tasks || joinApiPath(ctx.endpoints.base, "/tasks")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/routines", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "category", "premium"]);
  const url = `${ctx.endpoints.routines || joinApiPath(ctx.endpoints.base, "/routines")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/routines", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.routines || joinApiPath(ctx.endpoints.base, "/routines");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/routines/:routineId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const routineId = encodeURIComponent(String(req.params.routineId || "").trim());
  if (!routineId) return res.status(400).json({ message: "Gecersiz rutin id." });
  const url = joinApiPath(ctx.endpoints.base, `/routines/${routineId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/routines/:routineId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const routineId = encodeURIComponent(String(req.params.routineId || "").trim());
  if (!routineId) return res.status(400).json({ message: "Gecersiz rutin id." });
  const qs = buildProxyQuery(req.query, ["force"]);
  const url = `${joinApiPath(ctx.endpoints.base, `/routines/${routineId}`)}${qs}`;
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/events", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search"]);
  const url = `${ctx.endpoints.events || joinApiPath(ctx.endpoints.base, "/events")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/moods", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search"]);
  const url = `${ctx.endpoints.moods || joinApiPath(ctx.endpoints.base, "/moods")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/game-sessions", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "userId", "solved"]);
  const url = `${ctx.endpoints.gameSessions || joinApiPath(ctx.endpoints.base, "/game-sessions")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/chip-purchases", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "userId"]);
  const url = `${ctx.endpoints.chipPurchases || joinApiPath(ctx.endpoints.base, "/chip-purchases")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/podcasts", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status", "category", "userId", "user_id"]);
  const url = `${ctx.endpoints.podcasts || joinApiPath(ctx.endpoints.base, "/podcasts")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/podcasts/:podcastId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const podcastId = encodeURIComponent(String(req.params.podcastId || "").trim());
  if (!podcastId) return res.status(400).json({ message: "Gecersiz podcast id." });
  const url = joinApiPath(ctx.endpoints.base, `/podcasts/${podcastId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/podcasts/:podcastId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const podcastId = encodeURIComponent(String(req.params.podcastId || "").trim());
  if (!podcastId) return res.status(400).json({ message: "Gecersiz podcast id." });
  const url = joinApiPath(ctx.endpoints.base, `/podcasts/${podcastId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/episodes", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status", "podcastId"]);
  const url = `${ctx.endpoints.episodes || joinApiPath(ctx.endpoints.base, "/episodes")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/live-sessions", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status"]);
  const url = `${ctx.endpoints.liveSessions || joinApiPath(ctx.endpoints.base, "/live-sessions")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/templates", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "type", "browseType", "category"]);
  const url = `${ctx.endpoints.templates || joinApiPath(ctx.endpoints.base, "/templates")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/templates", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = ctx.endpoints.templates || joinApiPath(ctx.endpoints.base, "/templates");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.get("/:id/proxy/templates/:templateId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const templateId = encodeURIComponent(String(req.params.templateId || "").trim());
  if (!templateId) return res.status(400).json({ message: "Gecersiz sablon id." });

  const url = joinApiPath(ctx.endpoints.base, `/templates/${templateId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/templates/:templateId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const templateId = encodeURIComponent(String(req.params.templateId || "").trim());
  if (!templateId) return res.status(400).json({ message: "Gecersiz sablon id." });

  const url = joinApiPath(ctx.endpoints.base, `/templates/${templateId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/templates/:templateId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const templateId = encodeURIComponent(String(req.params.templateId || "").trim());
  if (!templateId) return res.status(400).json({ message: "Gecersiz sablon id." });

  const qs = buildProxyQuery(req.query, ["force"]);
  const url = `${joinApiPath(ctx.endpoints.base, `/templates/${templateId}`)}${qs}`;
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/templates/:templateId/preview", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const templateId = encodeURIComponent(String(req.params.templateId || "").trim());
  if (!templateId) return res.status(400).json({ message: "Gecersiz sablon id." });

  const url = joinApiPath(ctx.endpoints.base, `/templates/${templateId}/preview`);
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 200 });
});

router.get("/:id/proxy/stories", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status", "level"]);
  const url = `${ctx.endpoints.stories || joinApiPath(ctx.endpoints.base, "/stories")}${qs}`;
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { expectJson: true, timeoutMs: 30000 })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/stories", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const url = ctx.endpoints.stories || joinApiPath(ctx.endpoints.base, "/stories");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.get("/:id/proxy/stories/:storyId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const storyId = encodeURIComponent(String(req.params.storyId || "").trim());
  if (!storyId) return res.status(400).json({ message: "Gecersiz hikaye id." });

  const url = joinApiPath(ctx.endpoints.base, `/stories/${storyId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/stories/:storyId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const storyId = encodeURIComponent(String(req.params.storyId || "").trim());
  if (!storyId) return res.status(400).json({ message: "Gecersiz hikaye id." });

  const url = joinApiPath(ctx.endpoints.base, `/stories/${storyId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/stories/:storyId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const storyId = encodeURIComponent(String(req.params.storyId || "").trim());
  if (!storyId) return res.status(400).json({ message: "Gecersiz hikaye id." });

  const url = joinApiPath(ctx.endpoints.base, `/stories/${storyId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/courses", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "language"]);
  const url = `${ctx.endpoints.courses || joinApiPath(ctx.endpoints.base, "/courses")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/courses", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.courses || joinApiPath(ctx.endpoints.base, "/courses");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.get("/:id/proxy/courses/:courseId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const courseId = encodeURIComponent(String(req.params.courseId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/courses/${courseId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/courses/:courseId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const courseId = encodeURIComponent(String(req.params.courseId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/courses/${courseId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/courses/:courseId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const courseId = encodeURIComponent(String(req.params.courseId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/courses/${courseId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/lessons", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "courseId"]);
  const url = `${ctx.endpoints.lessons || joinApiPath(ctx.endpoints.base, "/lessons")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/lessons", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.lessons || joinApiPath(ctx.endpoints.base, "/lessons");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.get("/:id/proxy/lessons/:lessonId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const lessonId = encodeURIComponent(String(req.params.lessonId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/lessons/${lessonId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.patch("/:id/proxy/lessons/:lessonId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const lessonId = encodeURIComponent(String(req.params.lessonId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/lessons/${lessonId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/lessons/:lessonId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const lessonId = encodeURIComponent(String(req.params.lessonId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/lessons/${lessonId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/phrases", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "category", "language"]);
  const url = `${ctx.endpoints.phrases || joinApiPath(ctx.endpoints.base, "/phrases")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/phrases", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.phrases || joinApiPath(ctx.endpoints.base, "/phrases");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/phrases/:phraseId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const phraseId = encodeURIComponent(String(req.params.phraseId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/phrases/${phraseId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/phrases/:phraseId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const phraseId = encodeURIComponent(String(req.params.phraseId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/phrases/${phraseId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/activities", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "lessonId"]);
  const url = `${ctx.endpoints.activities || joinApiPath(ctx.endpoints.base, "/activities")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/activities", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.activities || joinApiPath(ctx.endpoints.base, "/activities");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/activities/:activityId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const activityId = encodeURIComponent(String(req.params.activityId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/activities/${activityId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/activities/:activityId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const activityId = encodeURIComponent(String(req.params.activityId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/activities/${activityId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/items", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "lessonId"]);
  const url = `${ctx.endpoints.items || joinApiPath(ctx.endpoints.base, "/items")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/items", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.items || joinApiPath(ctx.endpoints.base, "/items");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/items/:itemId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const itemId = encodeURIComponent(String(req.params.itemId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/items/${itemId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/items/:itemId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const itemId = encodeURIComponent(String(req.params.itemId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/items/${itemId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/languages", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.languages || joinApiPath(ctx.endpoints.base, "/languages");
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/languages", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.languages || joinApiPath(ctx.endpoints.base, "/languages");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/languages/:languageId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const languageId = encodeURIComponent(String(req.params.languageId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/languages/${languageId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.get("/:id/proxy/sections", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "storyId"]);
  const url = `${ctx.endpoints.sections || joinApiPath(ctx.endpoints.base, "/sections")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/sections", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.sections || joinApiPath(ctx.endpoints.base, "/sections");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/sections/:sectionId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const sectionId = encodeURIComponent(String(req.params.sectionId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/sections/${sectionId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/sections/:sectionId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const sectionId = encodeURIComponent(String(req.params.sectionId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/sections/${sectionId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/voices", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "lessonId", "language"]);
  const url = `${ctx.endpoints.voices || joinApiPath(ctx.endpoints.base, "/voices")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/menus", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "userId", "templateId"]);
  const url = `${ctx.endpoints.menus || joinApiPath(ctx.endpoints.base, "/menus")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/menus/:menuId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const menuId = encodeURIComponent(String(req.params.menuId || "").trim());
  if (!menuId) return res.status(400).json({ message: "Gecersiz menu id." });

  const url = joinApiPath(ctx.endpoints.base, `/menus/${menuId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/projects", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status", "userId", "templateId"]);
  const url = `${ctx.endpoints.projects || joinApiPath(ctx.endpoints.base, "/projects")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/projects/:projectId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const projectId = encodeURIComponent(String(req.params.projectId || "").trim());
  if (!projectId) return res.status(400).json({ message: "Gecersiz proje id." });

  const url = joinApiPath(ctx.endpoints.base, `/projects/${projectId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.delete("/:id/proxy/projects/:projectId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const projectId = encodeURIComponent(String(req.params.projectId || "").trim());
  if (!projectId) return res.status(400).json({ message: "Gecersiz proje id." });

  const url = joinApiPath(ctx.endpoints.base, `/projects/${projectId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/reviews", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "templateId"]);
  const url = `${ctx.endpoints.reviews || joinApiPath(ctx.endpoints.base, "/reviews")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.delete("/:id/proxy/reviews/:reviewId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const reviewId = encodeURIComponent(String(req.params.reviewId || "").trim());
  if (!reviewId) return res.status(400).json({ message: "Gecersiz yorum id." });

  const url = joinApiPath(ctx.endpoints.base, `/reviews/${reviewId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/brands", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "userId"]);
  const url = `${ctx.endpoints.brands || joinApiPath(ctx.endpoints.base, "/brands")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.delete("/:id/proxy/brands/:brandId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const brandId = encodeURIComponent(String(req.params.brandId || "").trim());
  if (!brandId) return res.status(400).json({ message: "Gecersiz marka id." });

  const url = joinApiPath(ctx.endpoints.base, `/brands/${brandId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/posts", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "status", "platform", "userId"]);
  const url = `${ctx.endpoints.posts || joinApiPath(ctx.endpoints.base, "/posts")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.delete("/:id/proxy/posts/:postId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const postId = encodeURIComponent(String(req.params.postId || "").trim());
  if (!postId) return res.status(400).json({ message: "Gecersiz gonderi id." });

  const url = joinApiPath(ctx.endpoints.base, `/posts/${postId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/documents", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "userId"]);
  const url = `${ctx.endpoints.documents || joinApiPath(ctx.endpoints.base, "/documents")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/documents/:documentId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const documentId = encodeURIComponent(String(req.params.documentId || "").trim());
  if (!documentId) return res.status(400).json({ message: "Gecersiz belge id." });

  const url = joinApiPath(ctx.endpoints.base, `/documents/${documentId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.delete("/:id/proxy/documents/:documentId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const documentId = encodeURIComponent(String(req.params.documentId || "").trim());
  if (!documentId) return res.status(400).json({ message: "Gecersiz belge id." });

  const url = joinApiPath(ctx.endpoints.base, `/documents/${documentId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/summaries", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "platform", "userUid", "userId"]);
  const url = `${ctx.endpoints.summaries || joinApiPath(ctx.endpoints.base, "/summaries")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/summaries/:summaryId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const summaryId = encodeURIComponent(String(req.params.summaryId || "").trim());
  if (!summaryId) return res.status(400).json({ message: "Gecersiz ozet id." });

  const url = joinApiPath(ctx.endpoints.base, `/summaries/${summaryId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.delete("/:id/proxy/summaries/:summaryId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const summaryId = encodeURIComponent(String(req.params.summaryId || "").trim());
  if (!summaryId) return res.status(400).json({ message: "Gecersiz ozet id." });

  const url = joinApiPath(ctx.endpoints.base, `/summaries/${summaryId}`);
  const result = await requestExternalUrl(
    url,
    externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true })
  );
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/tracks", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search"]);
  const url = `${joinApiPath(ctx.endpoints.base, "/tracks")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/tracks/:trackId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const trackId = encodeURIComponent(String(req.params.trackId || "").trim());
  if (!trackId) return res.status(400).json({ message: "Gecersiz parca id." });

  const url = joinApiPath(ctx.endpoints.base, `/tracks/${trackId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/tracks", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.tracks || joinApiPath(ctx.endpoints.base, "/tracks");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/tracks/:trackId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const trackId = encodeURIComponent(String(req.params.trackId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/tracks/${trackId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/tracks/:trackId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const trackId = encodeURIComponent(String(req.params.trackId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/tracks/${trackId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/words", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const qs = buildProxyQuery(req.query, ["page", "limit", "search", "trackId"]);
  const url = `${ctx.endpoints.words || joinApiPath(ctx.endpoints.base, "/words")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/words/:wordId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const wordId = encodeURIComponent(String(req.params.wordId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/words/${wordId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.post("/:id/proxy/words", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const url = ctx.endpoints.words || joinApiPath(ctx.endpoints.base, "/words");
  return proxyExternalWrite(req, res, ctx, { url, method: "POST", defaultCreated: 201 });
});

router.patch("/:id/proxy/words/:wordId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const wordId = encodeURIComponent(String(req.params.wordId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/words/${wordId}`);
  return proxyExternalWrite(req, res, ctx, { url, method: "PATCH", defaultCreated: 200 });
});

router.delete("/:id/proxy/words/:wordId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;
  const wordId = encodeURIComponent(String(req.params.wordId || "").trim());
  const url = joinApiPath(ctx.endpoints.base, `/words/${wordId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { method: "DELETE", expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/artists", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search"]);
  const url = `${joinApiPath(ctx.endpoints.base, "/artists")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/artists/:artistId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const artistId = encodeURIComponent(String(req.params.artistId || "").trim());
  if (!artistId) return res.status(400).json({ message: "Gecersiz sanatci id." });

  const url = joinApiPath(ctx.endpoints.base, `/artists/${artistId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/subscriptions", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search"]);
  const url = `${joinApiPath(ctx.endpoints.base, "/subscriptions")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/subscriptions/:subscriptionId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const subscriptionId = encodeURIComponent(String(req.params.subscriptionId || "").trim());
  if (!subscriptionId) return res.status(400).json({ message: "Gecersiz satin alim id." });

  const url = joinApiPath(ctx.endpoints.base, `/subscriptions/${subscriptionId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/sleep-sessions", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const qs = buildProxyQuery(req.query, ["page", "limit", "search"]);
  const url = `${joinApiPath(ctx.endpoints.base, "/sleep-sessions")}${qs}`;
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

router.get("/:id/proxy/sleep-sessions/:sessionId", authRequired, async (req, res) => {
  const ctx = await loadAppForProxy(req, res);
  if (!ctx) return;

  const sessionId = encodeURIComponent(String(req.params.sessionId || "").trim());
  if (!sessionId) return res.status(400).json({ message: "Gecersiz uyku oturumu id." });

  const url = joinApiPath(ctx.endpoints.base, `/sleep-sessions/${sessionId}`);
  const result = await requestExternalUrl(url, externalRequestOptions(ctx.app, { expectJson: true }));
  return res.status(proxyStatusCode(result)).json(result);
});

async function proxyGet(req, res, pickUrl, options) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz uygulama id." });
  }

  try {
    await ensureAppColumns();
    const app = await loadAppById(id);
    if (!app) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const endpoints = buildAppApiEndpoints(app);
    const url = pickUrl(endpoints);
    if (!url) {
      return res.status(400).json({ message: "API taban URL tanimli degil." });
    }

    const result = await requestExternalUrl(url, externalRequestOptions(app, options));
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({ message: "Dis API istegi basarisiz." });
  }
}

router.post("/", authRequired, async (req, res) => {
  const {
    appName,
    bundleId,
    latestVersion,
    status,
    iconUrl,
    apiBaseUrl,
    panelSlug,
    panelApiKey,
    revenuecatProjectId
  } = req.body;

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  if (!appName || !bundleId) {
    return res.status(400).json({ message: "Uygulama adi ve bundle id zorunludur." });
  }

  const safeApiBase = normalizeApiBaseUrl(apiBaseUrl);
  const errApi = assertHttpUrl(safeApiBase, "API URL");
  if (apiBaseUrl && !safeApiBase) return res.status(400).json({ message: errApi || "API URL gecersiz." });

  const safePanelSlug = normalizeOptionalSlug(panelSlug);
  const safePanelApiKey = normalizePanelApiKeyInput(panelApiKey);
  const safeRevenueCatProjectId = normalizeRevenueCatProjectIdInput(revenuecatProjectId);
  const safeStatus = ["READY", "PREPARE", "ISSUE"].includes(status) ? status : "PREPARE";
  const safeVersion = latestVersion?.trim() || "1.0.0";
  const safeIconUrl = normalizeOptionalUrl(iconUrl);

  try {
    await ensureAppColumns();

    const [result] = await pool.query(
      `
      INSERT INTO applications (
        app_name, bundle_id, latest_version, status, icon_url,
        api_base_url, panel_slug, panel_api_key, revenuecat_project_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        appName.trim(),
        bundleId.trim(),
        safeVersion,
        safeStatus,
        safeIconUrl,
        safeApiBase,
        safePanelSlug,
        safePanelApiKey ?? null,
        safeRevenueCatProjectId ?? null
      ]
    );

    const app = await loadAppById(result.insertId);
    return res.status(201).json({
      message: "Uygulama eklendi.",
      app: mapAppResponse(app, { includeSecrets: true })
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Bu bundle id zaten mevcut." });
    }
    return res.status(500).json({ message: "Uygulama eklenemedi." });
  }
});

router.put("/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz uygulama id." });
  }

  if (!isManagerRole(req.user?.role)) {
    return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
  }

  const {
    appName,
    bundleId,
    latestVersion,
    status,
    iconUrl,
    apiBaseUrl,
    panelSlug,
    panelApiKey,
    revenuecatProjectId
  } = req.body;

  if (!appName || !bundleId) {
    return res.status(400).json({ message: "Uygulama adi ve bundle id zorunludur." });
  }

  const safeApiBase = normalizeApiBaseUrl(apiBaseUrl);
  if (apiBaseUrl && !safeApiBase) {
    return res.status(400).json({ message: "API URL gecerli bir http(s) adresi olmalidir." });
  }

  const safePanelSlug = normalizeOptionalSlug(panelSlug);
  const safePanelApiKey = normalizePanelApiKeyInput(panelApiKey);
  const safeRevenueCatProjectId = normalizeRevenueCatProjectIdInput(revenuecatProjectId);
  const safeStatus = ["READY", "PREPARE", "ISSUE"].includes(status) ? status : "PREPARE";
  const safeVersion = latestVersion?.trim() || "1.0.0";
  const safeIconUrl = normalizeOptionalUrl(iconUrl);

  try {
    await ensureAppColumns();

    const existing = await loadAppById(id);
    if (!existing) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const panelKeyToSave = safePanelApiKey !== undefined ? safePanelApiKey : existing.panelApiKey;
    const rcProjectToSave =
      safeRevenueCatProjectId !== undefined
        ? safeRevenueCatProjectId
        : existing.revenuecatProjectId;

    const [result] = await pool.query(
      `
      UPDATE applications
      SET app_name = ?,
          bundle_id = ?,
          latest_version = ?,
          status = ?,
          icon_url = ?,
          api_base_url = ?,
          panel_slug = ?,
          panel_api_key = ?,
          revenuecat_project_id = ?
      WHERE id = ?
      `,
      [
        appName.trim(),
        bundleId.trim(),
        safeVersion,
        safeStatus,
        safeIconUrl,
        safeApiBase,
        safePanelSlug,
        panelKeyToSave,
        rcProjectToSave,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const app = await loadAppById(id);
    return res.json({
      message: "Uygulama guncellendi.",
      app: mapAppResponse(app, { includeSecrets: true })
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Bu bundle id baska bir uygulamada kullaniliyor." });
    }
    return res.status(500).json({ message: "Uygulama guncellenemedi." });
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz uygulama id." });
  }

  if (!isSuperAdmin(req.user?.role)) {
    return res.status(403).json({ message: "Uygulama kaldirma yalnizca Super Admin icindir." });
  }

  try {
    await ensureAppColumns();

    const existing = await loadAppById(id);
    if (!existing) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    const [result] = await pool.query("DELETE FROM applications WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Uygulama bulunamadi." });
    }

    return res.json({ message: "Uygulama kaldirildi." });
  } catch (error) {
    return res.status(500).json({ message: "Uygulama kaldirilamadi." });
  }
});

module.exports = router;
