const express = require("express");
const { pool } = require("../config/db");
const { authRequired, isManagerRole } = require("../middlewares/auth");
const { isYogifyFirebaseConfigured } = require("../config/yogifyFirebase");
const yogify = require("../services/yogifyFirestore");

const router = express.Router({ mergeParams: true });

async function loadYogifyApp(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ message: "Gecersiz uygulama id." });
    return null;
  }

  const [rows] = await pool.query(
    `
    SELECT id, app_name AS appName, bundle_id AS bundleId, panel_slug AS panelSlug
    FROM applications
    WHERE id = ?
    LIMIT 1
    `,
    [id]
  );

  const app = rows[0];
  if (!app) {
    res.status(404).json({ message: "Uygulama bulunamadi." });
    return null;
  }

  if (String(app.panelSlug || "").toLowerCase() !== "yogify") {
    res.status(400).json({ message: "Bu uygulama Yogify paneli degil." });
    return null;
  }

  if (!isYogifyFirebaseConfigured()) {
    const { resolveCredentialPath } = require("../config/yogifyFirebase");
    res.status(503).json({
      message:
        "Yogify Firebase service account eksik. secrets/yogify-service-account.json dosyasini ekleyin.",
      lookedAt: resolveCredentialPath(),
      cwd: process.cwd()
    });
    return null;
  }

  return app;
}

function requireManager(req, res) {
  if (!isManagerRole(req.user?.role)) {
    res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
    return false;
  }
  return true;
}

function handleError(res, error, fallback) {
  const status = error?.status || (error?.code === "YOGIFY_FIREBASE_MISSING" ? 503 : 500);
  return res.status(status).json({
    ok: false,
    message: error?.message || fallback
  });
}

router.get("/health", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  try {
    const health = await yogify.healthCheck();
    return res.json({ ok: true, ...health, appId: app.id, appName: app.appName });
  } catch (error) {
    return handleError(res, error, "Firebase baglantisi basarisiz.");
  }
});

router.get("/overview", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  try {
    const overview = await yogify.getOverview();
    return res.json({ ok: true, ...overview });
  } catch (error) {
    return handleError(res, error, "Ozet yuklenemedi.");
  }
});

router.get("/categories", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  try {
    const categories = await yogify.listCategories();
    return res.json({ ok: true, categories });
  } catch (error) {
    return handleError(res, error, "Kategoriler yuklenemedi.");
  }
});

router.post("/categories", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  if (!requireManager(req, res)) return;
  try {
    const category = await yogify.createCategory(req.body || {});
    return res.status(201).json({ ok: true, category });
  } catch (error) {
    return handleError(res, error, "Kategori eklenemedi.");
  }
});

router.patch("/categories/:categoryId", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  if (!requireManager(req, res)) return;
  try {
    const category = await yogify.updateCategory(req.params.categoryId, req.body || {});
    return res.json({ ok: true, category });
  } catch (error) {
    return handleError(res, error, "Kategori guncellenemedi.");
  }
});

router.delete("/categories/:categoryId", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  if (!requireManager(req, res)) return;
  try {
    const result = await yogify.deleteCategory(req.params.categoryId);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return handleError(res, error, "Kategori silinemedi.");
  }
});

router.get("/categories/:categoryId/videos", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  try {
    const videos = await yogify.listVideos(req.params.categoryId);
    return res.json({ ok: true, videos });
  } catch (error) {
    return handleError(res, error, "Videolar yuklenemedi.");
  }
});

router.post("/categories/:categoryId/videos", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  if (!requireManager(req, res)) return;
  try {
    const video = await yogify.createVideo(req.params.categoryId, req.body || {});
    return res.status(201).json({ ok: true, video });
  } catch (error) {
    return handleError(res, error, "Video eklenemedi.");
  }
});

router.patch(
  "/categories/:categoryId/videos/:videoId",
  authRequired,
  async (req, res) => {
    const app = await loadYogifyApp(req, res);
    if (!app) return;
    if (!requireManager(req, res)) return;
    try {
      const video = await yogify.updateVideo(
        req.params.categoryId,
        req.params.videoId,
        req.body || {}
      );
      return res.json({ ok: true, video });
    } catch (error) {
      return handleError(res, error, "Video guncellenemedi.");
    }
  }
);

router.delete(
  "/categories/:categoryId/videos/:videoId",
  authRequired,
  async (req, res) => {
    const app = await loadYogifyApp(req, res);
    if (!app) return;
    if (!requireManager(req, res)) return;
    try {
      const result = await yogify.deleteVideo(req.params.categoryId, req.params.videoId);
      return res.json({ ok: true, ...result });
    } catch (error) {
      return handleError(res, error, "Video silinemedi.");
    }
  }
);

router.get("/users", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  try {
    const result = await yogify.listUsers({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search || req.query.q
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return handleError(res, error, "Kullanicilar yuklenemedi.");
  }
});

router.get("/users/:uid", authRequired, async (req, res) => {
  const app = await loadYogifyApp(req, res);
  if (!app) return;
  try {
    const result = await yogify.getUser(req.params.uid);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return handleError(res, error, "Kullanici detayi yuklenemedi.");
  }
});

module.exports = router;
