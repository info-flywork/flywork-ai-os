const { getYogifyFirebase } = require("../config/yogifyFirebase");

const CATEGORIES = "yoga_categories";
const USERS = "users";

function serializeValue(value) {
  if (value == null) return value;
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  return value;
}

function docToObject(doc) {
  if (!doc?.exists) return null;
  return { id: doc.id, ...serializeValue(doc.data() || {}) };
}

function asInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asString(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim();
}

async function healthCheck() {
  const { db, projectId } = getYogifyFirebase();
  await db.collection(CATEGORIES).limit(1).get();
  return { ok: true, projectId, source: "firebase" };
}

async function getOverview() {
  const { db, projectId } = getYogifyFirebase();
  const [usersSnap, categoriesSnap] = await Promise.all([
    db.collection(USERS).count().get(),
    db.collection(CATEGORIES).count().get()
  ]);

  const categories = await listCategories();
  let videoCount = 0;
  for (const category of categories) {
    const videos = await listVideos(category.id);
    videoCount += videos.length;
  }

  const recentUsersSnap = await db
    .collection(USERS)
    .orderBy("createdAt", "desc")
    .limit(8)
    .get()
    .catch(async () => {
      // createdAt index yoksa fallback
      return db.collection(USERS).limit(8).get();
    });

  return {
    projectId,
    totals: {
      users: usersSnap.data().count || 0,
      categories: categoriesSnap.data().count || 0,
      videos: videoCount
    },
    recentUsers: recentUsersSnap.docs.map(docToObject)
  };
}

async function listCategories() {
  const { db } = getYogifyFirebase();
  let snap;
  try {
    snap = await db.collection(CATEGORIES).orderBy("order", "asc").get();
  } catch {
    snap = await db.collection(CATEGORIES).get();
  }
  const items = snap.docs.map(docToObject);
  items.sort((a, b) => asInt(a.order) - asInt(b.order));
  return items;
}

async function getCategory(categoryId) {
  const { db } = getYogifyFirebase();
  const doc = await db.collection(CATEGORIES).doc(categoryId).get();
  return docToObject(doc);
}

async function createCategory(payload) {
  const { db } = getYogifyFirebase();
  const name = asString(payload.name);
  if (!name) {
    const err = new Error("Kategori adi zorunlu.");
    err.status = 400;
    throw err;
  }

  const data = {
    name,
    imagePath: asString(payload.imagePath, "assets/images/home1.png"),
    order: asInt(payload.order, 0)
  };

  const ref = await db.collection(CATEGORIES).add(data);
  const created = await ref.get();
  return docToObject(created);
}

async function updateCategory(categoryId, payload) {
  const { db } = getYogifyFirebase();
  const ref = db.collection(CATEGORIES).doc(categoryId);
  const existing = await ref.get();
  if (!existing.exists) {
    const err = new Error("Kategori bulunamadi.");
    err.status = 404;
    throw err;
  }

  const patch = {};
  if (payload.name != null) {
    const name = asString(payload.name);
    if (!name) {
      const err = new Error("Kategori adi bos olamaz.");
      err.status = 400;
      throw err;
    }
    patch.name = name;
  }
  if (payload.imagePath != null) patch.imagePath = asString(payload.imagePath);
  if (payload.order != null) patch.order = asInt(payload.order, 0);

  if (!Object.keys(patch).length) {
    return docToObject(existing);
  }

  await ref.update(patch);
  return docToObject(await ref.get());
}

async function deleteCategory(categoryId) {
  const { db } = getYogifyFirebase();
  const ref = db.collection(CATEGORIES).doc(categoryId);
  const existing = await ref.get();
  if (!existing.exists) {
    const err = new Error("Kategori bulunamadi.");
    err.status = 404;
    throw err;
  }

  const videosSnap = await ref.collection("videos").get();
  const batch = db.batch();
  videosSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(ref);
  await batch.commit();
  return { ok: true, id: categoryId, deletedVideos: videosSnap.size };
}

async function listVideos(categoryId) {
  const { db } = getYogifyFirebase();
  const catRef = db.collection(CATEGORIES).doc(categoryId);
  const cat = await catRef.get();
  if (!cat.exists) {
    const err = new Error("Kategori bulunamadi.");
    err.status = 404;
    throw err;
  }

  let snap;
  try {
    snap = await catRef.collection("videos").orderBy("order", "asc").get();
  } catch {
    snap = await catRef.collection("videos").get();
  }
  const items = snap.docs.map(docToObject);
  items.sort((a, b) => asInt(a.order) - asInt(b.order));
  return items;
}

function buildVideoData(payload, { partial = false } = {}) {
  const data = {};
  if (!partial || payload.title != null) data.title = asString(payload.title);
  if (!partial || payload.description != null) {
    data.description = asString(payload.description);
  }
  if (!partial || payload.imagePath != null) {
    data.imagePath = asString(payload.imagePath, "assets/images/home1.png");
  }
  if (!partial || payload.videoUrl != null || payload.video_url != null) {
    data.video_url = asString(payload.videoUrl ?? payload.video_url);
  }
  if (!partial || payload.duration != null) {
    data.duration = asString(payload.duration, "00:00");
  }
  if (!partial || payload.order != null) data.order = asInt(payload.order, 0);

  if (!partial && !data.title) {
    const err = new Error("Video basligi zorunlu.");
    err.status = 400;
    throw err;
  }
  if (partial && payload.title != null && !data.title) {
    const err = new Error("Video basligi bos olamaz.");
    err.status = 400;
    throw err;
  }
  return data;
}

async function createVideo(categoryId, payload) {
  const { db } = getYogifyFirebase();
  const catRef = db.collection(CATEGORIES).doc(categoryId);
  const cat = await catRef.get();
  if (!cat.exists) {
    const err = new Error("Kategori bulunamadi.");
    err.status = 404;
    throw err;
  }

  const data = buildVideoData(payload, { partial: false });
  const ref = await catRef.collection("videos").add(data);
  return docToObject(await ref.get());
}

async function updateVideo(categoryId, videoId, payload) {
  const { db } = getYogifyFirebase();
  const ref = db.collection(CATEGORIES).doc(categoryId).collection("videos").doc(videoId);
  const existing = await ref.get();
  if (!existing.exists) {
    const err = new Error("Video bulunamadi.");
    err.status = 404;
    throw err;
  }

  const patch = buildVideoData(payload, { partial: true });
  if (!Object.keys(patch).length) return docToObject(existing);
  await ref.update(patch);
  return docToObject(await ref.get());
}

async function deleteVideo(categoryId, videoId) {
  const { db } = getYogifyFirebase();
  const ref = db.collection(CATEGORIES).doc(categoryId).collection("videos").doc(videoId);
  const existing = await ref.get();
  if (!existing.exists) {
    const err = new Error("Video bulunamadi.");
    err.status = 404;
    throw err;
  }
  await ref.delete();
  return { ok: true, id: videoId };
}

async function listUsers({ page = 1, limit = 20, search = "" } = {}) {
  const { db } = getYogifyFirebase();
  const safeLimit = Math.min(Math.max(asInt(limit, 20), 1), 100);
  const safePage = Math.max(asInt(page, 1), 1);
  const q = asString(search).toLowerCase();

  // Firestore full-text yok; makul bir batch çekip filtrele
  const snap = await db.collection(USERS).limit(500).get();
  let users = snap.docs.map(docToObject);

  if (q) {
    users = users.filter((u) => {
      const hay = `${u.email || ""} ${u.full_name || ""} ${u.uid || u.id || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  users.sort((a, b) => {
    const aTime = Date.parse(a.createdAt || a.updatedAt || 0) || 0;
    const bTime = Date.parse(b.createdAt || b.updatedAt || 0) || 0;
    return bTime - aTime;
  });

  const total = users.length;
  const start = (safePage - 1) * safeLimit;
  const items = users.slice(start, start + safeLimit);

  return {
    users: items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(Math.ceil(total / safeLimit), 1)
    }
  };
}

async function getUser(uid) {
  const { db } = getYogifyFirebase();
  const doc = await db.collection(USERS).doc(uid).get();
  if (!doc.exists) {
    const err = new Error("Kullanici bulunamadi.");
    err.status = 404;
    throw err;
  }

  const notificationsSnap = await db
    .collection(USERS)
    .doc(uid)
    .collection("app_notifications")
    .orderBy("createdAt", "desc")
    .limit(20)
    .get()
    .catch(async () =>
      db.collection(USERS).doc(uid).collection("app_notifications").limit(20).get()
    );

  return {
    user: docToObject(doc),
    notifications: notificationsSnap.docs.map(docToObject)
  };
}

module.exports = {
  healthCheck,
  getOverview,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  listVideos,
  createVideo,
  updateVideo,
  deleteVideo,
  listUsers,
  getUser
};
