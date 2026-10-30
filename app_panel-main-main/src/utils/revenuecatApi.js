const { requestExternalUrl } = require("./externalApi");
const {
  resolveRevenueCatApiKey,
  resolveRevenueCatProjectId
} = require("./revenueCatConfig");
const { isRevenueCatDebugEnabled, rcLog, maskProjectId } = require("./revenueCatLogger");
const env = require("../config/env");

const RC_BASE = "https://api.revenuecat.com/v2";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cacheKey(parts) {
  return parts.join("|");
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, { at: Date.now(), value });
}

function buildRcUrl(projectId, path, query = {}) {
  const url = new URL(`${RC_BASE}/projects/${encodeURIComponent(projectId)}${path}`);
  for (const [name, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== "") {
      url.searchParams.set(name, String(value).trim());
    }
  }
  return url.toString();
}

function redactUrl(url) {
  return String(url).replace(/Bearer\s+\S+/gi, "Bearer ***");
}

async function revenueCatGet(app, path, query = {}, options = {}) {
  const apiKey = resolveRevenueCatApiKey(app);
  const projectId = resolveRevenueCatProjectId(app);
  const logCtx = {
    panelSlug: app?.panelSlug,
    path,
    query
  };

  if (!apiKey) {
    rcLog("config_missing_api_key", logCtx);
    return { ok: false, error: "REVENUECAT_API_KEY tanimli degil." };
  }
  if (!projectId) {
    rcLog("config_missing_project_id", logCtx);
    return {
      ok: false,
      error: "RevenueCat project id tanimli degil (.env veya uygulama kaydi)."
    };
  }

  const useCache = options.useCache !== false;
  const key = cacheKey([projectId, path, JSON.stringify(query)]);
  if (useCache) {
    const hit = getCached(key);
    if (hit) {
      rcLog("cache_hit", { ...logCtx, projectId });
      return { ...hit, cached: true };
    }
  }

  const url = buildRcUrl(projectId, path, query);
  const started = Date.now();

  rcLog("request_start", {
    ...logCtx,
    projectId,
    url: redactUrl(url)
  });

  const result = await requestExternalUrl(url, {
    expectJson: true,
    timeoutMs: options.timeoutMs || 12000,
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  const durationMs = Date.now() - started;
  const itemCount = Array.isArray(result.bodyJson?.items)
    ? result.bodyJson.items.length
    : result.bodyJson?.metrics
      ? result.bodyJson.metrics.length
      : null;

  const payload = {
    ok: result.ok,
    statusCode: result.statusCode,
    bodyJson: result.bodyJson,
    error: result.error,
    bodySnippet: result.bodySnippet,
    projectId
  };

  if (!result.ok) {
    const rcMsg =
      result.bodyJson?.message ||
      result.bodyJson?.type ||
      result.bodySnippet ||
      result.error;
    payload.error = rcMsg || `RevenueCat HTTP ${result.statusCode || "hata"}`;
    rcLog("request_error", {
      ...logCtx,
      projectId,
      statusCode: result.statusCode,
      durationMs,
      error: payload.error,
      rcType: result.bodyJson?.type,
      bodySnippet: result.bodySnippet?.slice(0, 300)
    });
    return payload;
  }

  rcLog("request_ok", {
    ...logCtx,
    projectId,
    statusCode: result.statusCode,
    durationMs,
    itemCount,
    hasNextPage: Boolean(result.bodyJson?.next_page)
  });

  if (useCache) setCached(key, payload);
  return payload;
}

async function getOverviewMetrics(app, query = {}) {
  const currency = query.currency || env.revenuecatDefaultCurrency || "USD";
  return revenueCatGet(app, "/metrics/overview", { currency });
}

function parseStartingAfter(nextPage) {
  if (!nextPage) return null;
  try {
    const u = new URL(nextPage, RC_BASE);
    return u.searchParams.get("starting_after");
  } catch {
    const match = String(nextPage).match(/starting_after=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function msToIso(value) {
  if (value == null) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  try {
    return new Date(n).toISOString();
  } catch {
    return null;
  }
}

async function listCustomers(app, query = {}) {
  const params = {};
  if (query.limit) params.limit = query.limit;
  if (query.starting_after) params.starting_after = query.starting_after;
  if (query.search) params.search = query.search;
  return revenueCatGet(app, "/customers", params, { useCache: false });
}

function customerPathSegment(customerId) {
  return encodeURIComponent(String(customerId || "").trim());
}

function formatCustomerLabel(customerId) {
  if (!customerId) return "—";
  const id = String(customerId);
  if (id.startsWith("$RCAnonymousID:")) {
    return `Anonim · ${id.slice("$RCAnonymousID:".length, 28)}…`;
  }
  return id.length > 36 ? `${id.slice(0, 34)}…` : id;
}

function subscriptionQueryParams(query = {}) {
  const params = {};
  if (query.limit) params.limit = query.limit;
  if (query.starting_after) params.starting_after = query.starting_after;
  if (query.environment) params.environment = query.environment;
  return params;
}

async function listCustomerSubscriptions(app, customerId, query = {}) {
  const id = customerPathSegment(customerId);
  if (!id) return { ok: false, error: "Gecersiz customer id." };
  return revenueCatGet(
    app,
    `/customers/${id}/subscriptions`,
    subscriptionQueryParams(query),
    { useCache: false }
  );
}

async function listCustomerPurchases(app, customerId, query = {}) {
  const id = customerPathSegment(customerId);
  if (!id) return { ok: false, error: "Gecersiz customer id." };
  return revenueCatGet(
    app,
    `/customers/${id}/purchases`,
    subscriptionQueryParams(query),
    { useCache: false }
  );
}

async function listCustomerActiveEntitlements(app, customerId, query = {}) {
  const id = customerPathSegment(customerId);
  if (!id) return { ok: false, error: "Gecersiz customer id." };
  const params = {};
  if (query.limit) params.limit = query.limit;
  if (query.starting_after) params.starting_after = query.starting_after;
  return revenueCatGet(app, `/customers/${id}/active_entitlements`, params, {
    useCache: false
  });
}

async function getCustomer(app, customerId) {
  const id = customerPathSegment(customerId);
  if (!id) return { ok: false, error: "Gecersiz customer id." };
  return revenueCatGet(app, `/customers/${id}`, {}, { useCache: false });
}

async function listCustomerInvoices(app, customerId, query = {}) {
  const id = customerPathSegment(customerId);
  if (!id) return { ok: false, error: "Gecersiz customer id." };
  const params = {};
  if (query.limit) params.limit = query.limit;
  if (query.starting_after) params.starting_after = query.starting_after;
  return revenueCatGet(app, `/customers/${id}/invoices`, params, { useCache: false });
}

async function listCustomerAliases(app, customerId, query = {}) {
  const id = customerPathSegment(customerId);
  if (!id) return { ok: false, error: "Gecersiz customer id." };
  const params = {};
  if (query.limit) params.limit = query.limit;
  if (query.starting_after) params.starting_after = query.starting_after;
  return revenueCatGet(app, `/customers/${id}/aliases`, params, { useCache: false });
}

function extractCustomerAttributes(customer) {
  const items = customer?.attributes?.items || [];
  const map = {};
  for (const attr of items) {
    if (attr?.name) map[attr.name] = attr.value;
  }
  return map;
}

function normalizeInvoiceRow(invoice) {
  const total = invoice?.total_amount;
  return {
    id: invoice?.id,
    issuedAt: msToIso(invoice?.issued_at),
    paidAt: msToIso(invoice?.paid_at),
    invoiceUrl: invoice?.invoice_url || null,
    productLabel:
      invoice?.line_items?.[0]?.product_display_name ||
      invoice?.line_items?.[0]?.product_identifier ||
      null,
    amount: total?.gross ?? total?.proceeds,
    currency: total?.currency || "USD"
  };
}

async function getCustomerDetails(app, customerId, query = {}) {
  const environment = query.environment || "production";
  const id = String(customerId || "").trim();
  if (!id) return { ok: false, error: "Gecersiz customer id." };

  const [customerResult, subsResult, purchasesResult, invoicesResult, aliasesResult, entResult] =
    await Promise.all([
      getCustomer(app, id),
      listCustomerSubscriptions(app, id, { limit: 12, environment }),
      listCustomerPurchases(app, id, { limit: 12, environment }),
      listCustomerInvoices(app, id, { limit: 20 }),
      listCustomerAliases(app, id, { limit: 20 }),
      listCustomerActiveEntitlements(app, id, { limit: 10 })
    ]);

  if (!customerResult.ok && !subsResult.ok) {
    return {
      ok: false,
      error: customerResult.error || subsResult.error,
      statusCode: customerResult.statusCode || subsResult.statusCode
    };
  }

  const customer = customerResult.ok ? customerResult.bodyJson : null;
  const attributes = extractCustomerAttributes(customer);
  const aliasIds = (aliasesResult.ok ? aliasesResult.bodyJson?.items || [] : []).map(
    (a) => a.id
  );

  const subscriptions = (subsResult.ok ? subsResult.bodyJson?.items || [] : []).map((sub) =>
    normalizeSubscriptionRow({ id }, sub)
  );
  const purchases = (purchasesResult.ok ? purchasesResult.bodyJson?.items || [] : []).map(
    (purchase) => normalizePurchaseRow({ id }, purchase)
  );
  const invoices = (invoicesResult.ok ? invoicesResult.bodyJson?.items || [] : []).map(
    normalizeInvoiceRow
  );
  const entitlements = entResult.ok ? entResult.bodyJson?.items || [] : [];

  return {
    ok: true,
    bodyJson: {
      customerId: id,
      customerLabel: formatCustomerLabel(id),
      customer: customer
        ? {
            id: customer.id,
            firstSeenAt: msToIso(customer.first_seen_at),
            lastSeenAt: msToIso(customer.last_seen_at),
            country: customer.last_seen_country,
            platform: customer.last_seen_platform,
            appVersion: customer.last_seen_app_version
          }
        : null,
      attributes,
      aliasIds,
      entitlements,
      subscriptions,
      purchases,
      invoices,
      errors: {
        customer: customerResult.ok ? null : customerResult.error,
        subscriptions: subsResult.ok ? null : subsResult.error,
        purchases: purchasesResult.ok ? null : purchasesResult.error,
        invoices: invoicesResult.ok ? null : invoicesResult.error,
        aliases: aliasesResult.ok ? null : aliasesResult.error
      }
    }
  };
}

function storeLabelTr(store) {
  const s = String(store || "").toLowerCase();
  if (s === "app_store") return "APPLE";
  if (s === "play_store") return "GOOGLE";
  if (s === "stripe") return "STRIPE";
  if (s === "amazon") return "AMAZON";
  return s ? s.toLocaleUpperCase("tr-TR") : "—";
}

function humanizeStoreProduct(storeId) {
  const raw = String(storeId || "").trim();
  if (!raw) return "—";
  const lower = raw.toLowerCase();
  if (lower.includes("homeworksnap") || lower.includes("homework")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "HomeworkSnap Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "HomeworkSnap Pro (aylık)";
    }
    return "HomeworkSnap Pro";
  }
  if (
    lower.includes("livelingola") ||
    lower.includes("live_lingola") ||
    lower.includes("live-lingola") ||
    lower.includes("live.lingola")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Live Lingola Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Live Lingola Pro (aylık)";
    }
    return "Live Lingola Pro";
  }
  if (lower.includes("lingola") || lower.includes("lingolabuddy")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Lingola Buddy Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Lingola Buddy Pro (aylık)";
    }
    return "Lingola Buddy Pro";
  }
  if (lower.includes("aulix") || lower.includes("aimusic") || lower.includes("fw.aimusic")) {
    if (lower.includes("credit")) return "Aulix Kredi Paketi";
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Aulix Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Aulix Pro (aylık)";
    }
    return "Aulix Pro";
  }
  if (lower.includes("nightflow")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "NightFlow Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "NightFlow Pro (aylık)";
    }
    return "NightFlow Pro";
  }
  if (lower.includes("menuma")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "MenuMa Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "MenuMa Pro (aylık)";
    }
    return "MenuMa Pro";
  }
  if (lower.includes("slidify")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Slidify Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Slidify Pro (aylık)";
    }
    if (lower.includes("lifetime") || lower.includes("life")) {
      return "Slidify Pro (ömür boyu)";
    }
    return "Slidify Pro";
  }
  if (lower.includes("smplanner") || lower.includes("sm_planner") || lower.includes("sm-planner")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "SM Planner Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "SM Planner Pro (aylık)";
    }
    return "SM Planner Pro";
  }
  if (lower.includes("filetranslate") || lower.includes("file_translate") || lower.includes("file-translate")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "FileTranslate Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "FileTranslate Pro (aylık)";
    }
    return "FileTranslate Pro";
  }
  if (
    lower.includes("videosummary") ||
    lower.includes("video_summary") ||
    lower.includes("video-summary")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "VideoSummary Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "VideoSummary Pro (aylık)";
    }
    return "VideoSummary Pro";
  }
  if (
    lower.includes("filechat") ||
    lower.includes("file_chat") ||
    lower.includes("file-chat")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "FileChat Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "FileChat Pro (aylık)";
    }
    return "FileChat Pro";
  }
  if (
    lower.includes("homifit") ||
    lower.includes("home_fit") ||
    lower.includes("home-fit")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "HomiFit Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "HomiFit Pro (aylık)";
    }
    return "HomiFit Pro";
  }
  if (
    lower.includes("fitgym") ||
    lower.includes("fit_gym") ||
    lower.includes("fit-gym")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "FitGym Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "FitGym Pro (aylık)";
    }
    return "FitGym Pro";
  }
  if (
    lower.includes("momfit") ||
    lower.includes("mom_fit") ||
    lower.includes("mom-fit")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "MomFit Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "MomFit Pro (aylık)";
    }
    return "MomFit Pro";
  }
  if (
    lower.includes("signivo") ||
    lower.includes("esign")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Signivo Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Signivo Pro (aylık)";
    }
    return "Signivo Pro";
  }
  if (
    lower.includes("lingolawords") ||
    lower.includes("lingola_words") ||
    lower.includes("lingola-words") ||
    lower.includes("lingoladailywords") ||
    lower.includes("dailywords") ||
    lower.includes("daily_words")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Lingola Words (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Lingola Words (aylık)";
    }
    return "Lingola Words";
  }
  if (
    lower.includes("storylang") ||
    lower.includes("lingolastories") ||
    lower.includes("lingola_stories") ||
    lower.includes("lingola-stories")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Lingola Stories (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Lingola Stories (aylık)";
    }
    return "Lingola Stories";
  }
  if (
    lower.includes("lingolatravel") ||
    lower.includes("lingola_travel") ||
    lower.includes("lingola-travel")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Lingola Travel (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Lingola Travel (aylık)";
    }
    return "Lingola Travel";
  }
  if (
    lower.includes("lingolakids") ||
    lower.includes("lingola_kids") ||
    lower.includes("lingola-kids")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Lingola Kids (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Lingola Kids (aylık)";
    }
    return "Lingola Kids";
  }
  if (
    lower.includes("storieskids") ||
    lower.includes("stories_kids") ||
    lower.includes("lingolastorieskids")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Lingola Stories Kids (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Lingola Stories Kids (aylık)";
    }
    return "Lingola Stories Kids";
  }
  if (
    lower.includes("lingolajob") ||
    lower.includes("lingola_job") ||
    lower.includes("lingolajobapp")
  ) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("annual")) {
      return "Lingola Job (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Lingola Job (aylık)";
    }
    return "Lingola Job";
  }
  if (lower.includes("yogiface") || lower.includes("yogify")) {
    if (lower.includes("yearly") || lower.includes("year") || lower.includes("yillik")) {
      return "Yogiface Pro (yıllık)";
    }
    if (lower.includes("monthly") || lower.includes("month")) {
      return "Yogiface Pro (aylık)";
    }
    return "Yogiface Pro";
  }
  return raw.replace(/_/g, " ").replace(/:/g, " · ");
}

function resolveProductLabel(subscription) {
  const ent = subscription?.entitlements?.items?.[0];
  const productItem = ent?.products?.items?.[0];
  const storeId = productItem?.store_identifier || subscription?.product_id;
  if (storeId) return humanizeStoreProduct(storeId);
  if (ent?.lookup_key) return String(ent.lookup_key);
  if (ent?.display_name) return String(ent.display_name);
  if (productItem?.display_name) return String(productItem.display_name);
  return subscription?.product_id || "—";
}

function parseCustomerIds(query = {}) {
  const raw = query.customerIds || query.customer_ids || "";
  if (!raw) return [];
  return [...new Set(String(raw).split(",").map((id) => id.trim()).filter(Boolean))];
}

function countUniqueSubscriptionCustomers(rows) {
  return new Set(rows.map((row) => String(row.customerIdRaw || row.customerId || ""))).size;
}

function chartDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start_date: fmt(start), end_date: fmt(end) };
}

function chartAllTimeRange() {
  const end = new Date();
  return {
    start_date: "2015-01-01",
    end_date: end.toISOString().slice(0, 10)
  };
}

function extractChartRevenueTotal(chartResult, currency) {
  if (!chartResult?.ok || !chartResult.bodyJson?.summary) return null;
  const raw = chartResult.bodyJson.summary.total ?? chartResult.bodyJson.summary.sum;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  return { value: Number(raw), currency };
}

async function fetchChartRevenueTotal(app, currency, period) {
  const range =
    period === "all" ? chartAllTimeRange() : chartDateRange(period === "6m" ? 180 : 30);

  const chart = await getChartData(app, "revenue", {
    currency,
    start_date: range.start_date,
    end_date: range.end_date,
    aggregate: "total",
    useCache: true
  });

  const total = extractChartRevenueTotal(chart, currency);
  return {
    period,
    ok: chart.ok,
    error: chart.error,
    total,
    range
  };
}

const OVERVIEW_LABELS = {
  mrr: "MRR",
  arr: "ARR",
  active_subscriptions: "Aktif abonelik",
  active_trials: "Aktif deneme",
  revenue: "Gelir"
};

function pickOverviewMetric(metrics, id) {
  const m = (metrics || []).find((item) => item.id === id);
  if (!m || m.value == null) return null;
  return {
    id,
    label: OVERVIEW_LABELS[id] || m.name || id,
    value: Number(m.value),
    unit: m.unit || ""
  };
}

async function getRevenueSummary(app) {
  const currency = env.revenuecatDefaultCurrency || "USD";

  const [overview, revenue1m, revenue6m, revenueAll] = await Promise.all([
    getOverviewMetrics(app, { currency }),
    fetchChartRevenueTotal(app, currency, "1m"),
    fetchChartRevenueTotal(app, currency, "6m"),
    fetchChartRevenueTotal(app, currency, "all")
  ]);

  const metrics = overview.ok ? overview.bodyJson?.metrics || [] : [];
  const revenue1mTotal = revenue1m.total;
  const revenue6mTotal = revenue6m.total;
  const revenueAllTotal = revenueAll.total;

  return {
    ok: overview.ok || revenue1m.ok || revenue6m.ok || revenueAll.ok,
    bodyJson: {
      currency,
      mrr: pickOverviewMetric(metrics, "mrr"),
      arr: pickOverviewMetric(metrics, "arr"),
      activeSubscriptions: pickOverviewMetric(metrics, "active_subscriptions"),
      activeTrials: pickOverviewMetric(metrics, "active_trials"),
      revenue1m: revenue1mTotal,
      revenue6m: revenue6mTotal,
      revenueAllTime: revenueAllTotal,
      revenue30d: revenue1mTotal,
      revenuePeriods: {
        "1m": {
          label: "Son 1 ay",
          ok: revenue1m.ok,
          error: revenue1m.error,
          value: revenue1mTotal?.value ?? null,
          currency: revenue1mTotal?.currency || currency
        },
        "6m": {
          label: "Son 6 ay",
          ok: revenue6m.ok,
          error: revenue6m.error,
          value: revenue6mTotal?.value ?? null,
          currency: revenue6mTotal?.currency || currency
        },
        all: {
          label: "Tum zamanlar",
          ok: revenueAll.ok,
          error: revenueAll.error,
          value: revenueAllTotal?.value ?? null,
          currency: revenueAllTotal?.currency || currency
        }
      },
      overviewOk: overview.ok,
      chartsOk: revenue1m.ok && revenue6m.ok && revenueAll.ok,
      overviewError: overview.error || null,
      chartErrors: {
        "1m": revenue1m.error || null,
        "6m": revenue6m.error || null,
        all: revenueAll.error || null
      }
    }
  };
}

function normalizeSubscriptionRow(customer, subscription) {
  const revenue = subscription?.total_revenue_in_usd;
  const invoicePdfUrl =
    subscription?.invoice_pdf_url ||
    subscription?.invoice_url ||
    subscription?.latest_invoice_url ||
    subscription?.transaction?.invoice_pdf_url ||
    null;
  const managementUrl = subscription?.management_url || null;
  const rawCustomerId = customer?.id || subscription?.customer_id;
  const appUserIdHint = /^\d+$/.test(String(rawCustomerId || "")) ? String(rawCustomerId) : null;
  return {
    id: `${customer?.id}:${subscription?.id}`,
    customerId: customer?.id || subscription?.customer_id,
    customerLabel: formatCustomerLabel(customer?.id || subscription?.customer_id),
    customerIdRaw: customer?.id || subscription?.customer_id,
    appUserIdHint,
    country: subscription?.country || customer?.last_seen_country || null,
    productId: subscription?.product_id,
    productLabel: resolveProductLabel(subscription),
    status: subscription?.status,
    givesAccess: subscription?.gives_access,
    purchasedAt: msToIso(subscription?.starts_at || subscription?.current_period_starts_at),
    expiresAt: msToIso(subscription?.ends_at || subscription?.current_period_ends_at),
    price: revenue?.gross ?? revenue?.proceeds,
    totalSpent: revenue?.gross ?? revenue?.proceeds,
    currency: revenue?.currency || "USD",
    recordType: "subscription",
    environment: subscription?.environment,
    store: subscription?.store,
    storeLabel: storeLabelTr(subscription?.store),
    autoRenewalStatus: subscription?.auto_renewal_status,
    invoicePdfUrl,
    managementUrl
  };
}

function normalizePurchaseRow(customer, purchase) {
  const revenue = purchase?.revenue_in_usd || purchase?.total_revenue_in_usd;
  const invoicePdfUrl =
    purchase?.invoice_pdf_url ||
    purchase?.invoice_url ||
    purchase?.receipt_pdf_url ||
    purchase?.receipt_url ||
    purchase?.transaction?.invoice_pdf_url ||
    null;
  return {
    id: `${customer?.id}:${purchase?.id}`,
    customerId: customer?.id || purchase?.customer_id,
    customerLabel: formatCustomerLabel(customer?.id || purchase?.customer_id),
    customerIdRaw: customer?.id || purchase?.customer_id,
    productId: purchase?.product_id,
    status: purchase?.status || "purchase",
    givesAccess: purchase?.gives_access,
    purchasedAt: msToIso(purchase?.purchased_at),
    expiresAt: msToIso(purchase?.expires_at),
    price: revenue?.gross ?? revenue?.proceeds,
    currency: revenue?.currency || "USD",
    recordType: "purchase",
    environment: purchase?.environment,
    store: purchase?.store,
    invoicePdfUrl
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function emptyStats() {
  return {
    subscriptionRows: 0,
    purchaseRows: 0,
    subsErrors: 0,
    purchaseErrors: 0,
    subsEmpty: 0,
    purchaseEmpty: 0,
    customersWithEntitlements: 0,
    customersChecked: 0
  };
}

function isRelevantSubscription(sub) {
  if (sub?.gives_access === true) return true;
  const status = String(sub?.status || "").toLowerCase();
  return ["active", "trialing", "grace_period", "in_grace_period"].includes(status);
}

function subscriptionQueryForEnvironment(environment, extra = {}) {
  const params = { ...extra };
  if (environment) params.environment = environment;
  return params;
}

async function collectRowsForCustomers(app, customers, environment, hooks = {}) {
  const rows = [];
  const stats = emptyStats();
  const { pushDebug } = hooks;

  const customersToScan = customers.filter((customer) => String(customer?.id || "").trim());
  stats.customersChecked = customersToScan.length;

  if (!customersToScan.length) {
    return { rows, stats };
  }

  pushDebug?.("customer_scan", {
    batchSize: customersToScan.length,
    environment: environment ?? "all"
  });

  await mapWithConcurrency(customersToScan, 4, async (customer) => {
    const [subsResult, purchasesResult, entResult] = await Promise.all([
      listCustomerSubscriptions(
        app,
        customer.id,
        subscriptionQueryForEnvironment(environment, { limit: 12 })
      ),
      listCustomerPurchases(
        app,
        customer.id,
        subscriptionQueryForEnvironment(environment, { limit: 5 })
      ),
      listCustomerActiveEntitlements(app, customer.id, { limit: 1 })
    ]);

    if (entResult.ok && (entResult.bodyJson?.items || []).length > 0) {
      stats.customersWithEntitlements += 1;
    }

    if (!subsResult.ok) {
      stats.subsErrors += 1;
      pushDebug?.("customer_subs_error", {
        customerId: customer.id,
        environment,
        statusCode: subsResult.statusCode,
        error: subsResult.error
      });
      rcLog("feed_customer_subs_error", {
        customerId: customer.id,
        environment,
        statusCode: subsResult.statusCode,
        error: subsResult.error
      });
    } else {
      const subItems = subsResult.bodyJson?.items || [];
      const relevantSubs = subItems.filter(isRelevantSubscription);
      if (!relevantSubs.length) stats.subsEmpty += 1;
      for (const sub of relevantSubs) {
        rows.push(normalizeSubscriptionRow(customer, sub));
        stats.subscriptionRows += 1;
      }
    }

    if (!purchasesResult.ok) {
      stats.purchaseErrors += 1;
      pushDebug?.("customer_purchases_error", {
        customerId: customer.id,
        environment,
        statusCode: purchasesResult.statusCode,
        error: purchasesResult.error
      });
      rcLog("feed_customer_purchases_error", {
        customerId: customer.id,
        environment,
        statusCode: purchasesResult.statusCode,
        error: purchasesResult.error
      });
    } else {
      const purchaseItems = purchasesResult.bodyJson?.items || [];
      if (!purchaseItems.length) stats.purchaseEmpty += 1;
      for (const purchase of purchaseItems) {
        rows.push(normalizePurchaseRow(customer, purchase));
        stats.purchaseRows += 1;
      }
    }
  });

  return { rows, stats };
}

function resolveEnvironmentsToTry(requestedEnv) {
  if (requestedEnv === "production" || requestedEnv === "sandbox") {
    return [requestedEnv];
  }
  return [null, "production", "sandbox"];
}

function mergeStats(a, b) {
  return {
    subscriptionRows: a.subscriptionRows + b.subscriptionRows,
    purchaseRows: a.purchaseRows + b.purchaseRows,
    subsErrors: a.subsErrors + b.subsErrors,
    purchaseErrors: a.purchaseErrors + b.purchaseErrors,
    subsEmpty: a.subsEmpty + b.subsEmpty,
    purchaseEmpty: a.purchaseEmpty + b.purchaseEmpty,
    customersWithEntitlements:
      a.customersWithEntitlements + b.customersWithEntitlements,
    customersChecked: a.customersChecked + b.customersChecked
  };
}

function filterRowsByEnvironment(rows, requestedEnv) {
  if (!requestedEnv || requestedEnv === "auto") return rows;
  return rows.filter((row) => String(row.environment || "").toLowerCase() === requestedEnv);
}

async function collectFeedRowsForCustomers(app, customers, requestedEnv, hooks = {}) {
  const environmentsToTry = resolveEnvironmentsToTry(requestedEnv);
  let rows = [];
  let stats = emptyStats();

  for (const envName of environmentsToTry) {
    const collected = await collectRowsForCustomers(app, customers, envName, hooks);
    stats = mergeStats(stats, collected.stats);
    if (collected.rows.length > 0) {
      rows.push(...collected.rows);
    }
  }

  return { rows, stats };
}

async function getSubscriptionFeed(app, query = {}) {
  const customerLimit = Math.min(Math.max(Number(query.limit) || 20, 1), 25);
  const requestedEnv = query.environment || "auto";
  const includeDebug = isRevenueCatDebugEnabled() || query.includeDebug;
  const debug = [];
  const projectId = resolveRevenueCatProjectId(app);
  const explicitCustomerIds = parseCustomerIds(query);
  const scanAll =
    query.scanAll === true ||
    query.scanAll === "1" ||
    query.scanAll === "true";
  const shouldPaginateScan = !query.search && !query.starting_after;
  const maxScanPages = shouldPaginateScan
    ? explicitCustomerIds.length && !scanAll
      ? 0
      : scanAll
        ? 50
        : Math.min(Math.max(Number(query.scanPages) || 2, 1), 30)
    : 0;
  const skipMetrics = query.skipMetrics === true || query.skipMetrics === "1" || query.skipMetrics === "true";

  const pushDebug = (step, detail) => {
    if (!includeDebug) return;
    debug.push({ step, ...detail });
  };

  rcLog("feed_start", {
    panelSlug: app?.panelSlug,
    projectId: maskProjectId(projectId),
    customerLimit,
    environment: requestedEnv,
    maxScanPages,
    search: query.search || null,
    starting_after: query.starting_after || null
  });

  let summaryResult = { ok: false };
  let overviewResult = { ok: false };
  let targetEntitledCount = 0;

  if (!skipMetrics) {
    summaryResult = await getRevenueSummary(app);
    overviewResult = await getOverviewMetrics(app);
    const overviewMetrics = overviewResult.ok ? overviewResult.bodyJson?.metrics || [] : [];
    const activeTrialsMetric = overviewMetrics.find((m) => m.id === "active_trials");
    const activeSubsMetric = overviewMetrics.find((m) => m.id === "active_subscriptions");
    targetEntitledCount =
      (Number(activeTrialsMetric?.value) || 0) + (Number(activeSubsMetric?.value) || 0);
  }

  const environmentsToTry = resolveEnvironmentsToTry(requestedEnv);
  let rows = [];
  let stats = emptyStats();
  let effectiveEnvironment = requestedEnv === "auto" ? "all" : requestedEnv;
  let environmentNote = null;
  let customersScanned = 0;
  let customersResult = null;
  let cursor = query.starting_after || null;
  const skipCustomerIds = new Set(explicitCustomerIds.map(String));

  if (explicitCustomerIds.length) {
    const customers = explicitCustomerIds.map((id) => ({ id: String(id) }));
    const fromIds = await collectFeedRowsForCustomers(app, customers, requestedEnv, {
      pushDebug
    });
    rows.push(...fromIds.rows);
    stats = mergeStats(stats, fromIds.stats);
    customersScanned += customers.length;
    pushDebug("premium_customer_ids", {
      count: customers.length,
      rowCount: fromIds.rows.length
    });
    if (fromIds.rows.length > 0 && requestedEnv === "auto") {
      environmentNote = "Premium kullanıcı kimlikleri üzerinden doğrudan çekildi.";
    }
  }

  for (let page = 0; page < maxScanPages; page += 1) {
    customersResult = await listCustomers(app, {
      limit: customerLimit,
      starting_after: cursor,
      search: query.search
    });

    if (!customersResult.ok) {
      rcLog("feed_customers_failed", {
        panelSlug: app?.panelSlug,
        error: customersResult.error,
        statusCode: customersResult.statusCode,
        page
      });
      return {
        ...customersResult,
        bodyJson: summaryResult.ok ? { summary: summaryResult.bodyJson } : undefined,
        debug: includeDebug ? debug : undefined
      };
    }

    const batch = (customersResult.bodyJson?.items || []).filter(
      (customer) => !skipCustomerIds.has(String(customer?.id || ""))
    );
    customersScanned += batch.length;
    pushDebug("customers_page", {
      page: page + 1,
      count: batch.length,
      statusCode: customersResult.statusCode
    });

    rcLog("feed_customers_page", {
      panelSlug: app?.panelSlug,
      page: page + 1,
      batchSize: batch.length,
      customersScanned
    });

    const collected = await collectFeedRowsForCustomers(app, batch, requestedEnv, { pushDebug });
    stats = mergeStats(stats, collected.stats);
    rcLog("feed_environment_pass", {
      panelSlug: app?.panelSlug,
      page: page + 1,
      environment: requestedEnv,
      rowCount: collected.rows.length
    });

    if (collected.rows.length > 0) {
      rows.push(...collected.rows);
      if (requestedEnv === "auto") {
        environmentNote = explicitCustomerIds.length
          ? "Premium kullanıcılar + RC müşteri taraması birleştirildi."
          : "Kayıtlar tüm ortamlardan birleştirildi.";
      }
    }

    cursor = parseStartingAfter(customersResult.bodyJson?.next_page);
    if (!cursor) break;

    const uniqueCustomers = countUniqueSubscriptionCustomers(rows);
    if (
      targetEntitledCount > 0 &&
      uniqueCustomers >= targetEntitledCount &&
      rows.length >= targetEntitledCount
    ) {
      rcLog("feed_early_stop", {
        panelSlug: app?.panelSlug,
        targetEntitledCount,
        customersWithEntitlements: stats.customersWithEntitlements,
        rows: rows.length
      });
      break;
    }
  }

  rows = filterRowsByEnvironment(rows, requestedEnv);

  if (customersScanned > 0 && rows.length === 0 && !explicitCustomerIds.length) {
    environmentNote =
      `${customersScanned} RC müşterisi tarandı (${stats.customersWithEntitlements} aktif entitlement); ` +
      "abonelik kaydı listelenemedi.";
    if (summaryResult.ok) {
      const trials = summaryResult.bodyJson?.activeTrials?.value;
      const active = summaryResult.bodyJson?.activeSubscriptions?.value;
      if (trials > 0 || active > 0) {
        environmentNote +=
          ` Özet: ${trials ?? 0} deneme, ${active ?? 0} aktif abonelik — RC API ile eşleşen kayıt aranıyor.`;
      }
    }
    rcLog("feed_empty_after_scan", {
      panelSlug: app?.panelSlug,
      customersScanned,
      pagesScanned: maxScanPages,
      environmentsTried: environmentsToTry.map((e) => e ?? "all"),
      stats
    });
  }

  const seen = new Set();
  rows = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  rows.sort((a, b) => {
    const ta = a.purchasedAt ? Date.parse(a.purchasedAt) : 0;
    const tb = b.purchasedAt ? Date.parse(b.purchasedAt) : 0;
    return tb - ta;
  });

  if (query.search) {
    const q = String(query.search).trim().toLocaleLowerCase("tr-TR");
    if (q) {
      rows = rows.filter((row) => {
        const haystack = [
          row.customerLabel,
          row.customerIdRaw,
          row.productLabel,
          row.productId,
          row.country,
          row.status,
          row.storeLabel
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("tr-TR");
        return haystack.includes(q);
      });
    }
  }

  rcLog("feed_done", {
    panelSlug: app?.panelSlug,
    customersFetched: customersScanned,
    totalRows: rows.length,
    effectiveEnvironment: effectiveEnvironment ?? "all",
    stats,
    environmentNote
  });

  pushDebug("summary", {
    ...stats,
    totalRows: rows.length,
    customersScanned,
    effectiveEnvironment: effectiveEnvironment ?? "all",
    environmentNote
  });

  return {
    ok: true,
    projectId: customersResult?.projectId || projectId,
    bodyJson: {
      rows,
      source: "revenuecat",
      customersFetched: customersScanned,
      environment: effectiveEnvironment ?? "all",
      environmentsTried: environmentsToTry.map((e) => e ?? "all"),
      environmentNote,
      stats,
      summary: summaryResult.ok ? summaryResult.bodyJson : null,
      summaryError: summaryResult.ok ? null : summaryResult.error,
      pagination: {
        limit: customerLimit,
        pagesScanned: maxScanPages,
        hasMore: Boolean(customersResult?.bodyJson?.next_page),
        nextStartingAfter: parseStartingAfter(customersResult?.bodyJson?.next_page)
      },
      debug: includeDebug ? debug : undefined
    }
  };
}

async function getChartData(app, chartName, query = {}) {
  const currency = query.currency || env.revenuecatDefaultCurrency || "USD";
  const params = {
    currency,
    realtime: query.realtime ?? "true"
  };
  if (query.start_date) params.start_date = query.start_date;
  if (query.end_date) params.end_date = query.end_date;
  if (query.aggregate) params.aggregate = query.aggregate;

  return revenueCatGet(
    app,
    `/charts/${encodeURIComponent(chartName)}`,
    params,
    { useCache: query.useCache }
  );
}

module.exports = {
  getOverviewMetrics,
  getChartData,
  getRevenueSummary,
  listCustomers,
  getCustomer,
  listCustomerSubscriptions,
  listCustomerPurchases,
  listCustomerActiveEntitlements,
  listCustomerInvoices,
  listCustomerAliases,
  getCustomerDetails,
  getSubscriptionFeed,
  extractCustomerAttributes,
  formatCustomerLabel
};
