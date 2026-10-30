const { resolvePanelApiBaseUrl } = require("./panelApiUrls");

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function normalizeApiBaseUrl(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!["http:", "https:"].includes(u.protocol)) {
      return null;
    }
    return trimTrailingSlash(u.toString());
  } catch {
    return null;
  }
}

function joinApiPath(baseUrl, path) {
  const base = trimTrailingSlash(baseUrl);
  const segment = path.startsWith("/") ? path : `/${path}`;
  return `${base}${segment}`;
}

function deriveBaseFromLegacyUrl(fullUrl) {
  if (!fullUrl) return null;
  try {
    const u = new URL(fullUrl);
    const stripped = u.pathname
      .replace(/\/(health|analyse|users)\/?$/i, "")
      .replace(/\/$/, "");
    u.pathname = stripped || "";
    u.search = "";
    u.hash = "";
    const normalized = trimTrailingSlash(u.toString());
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

function resolveApiBaseUrl(app) {
  const resolved = resolvePanelApiBaseUrl({
    apiBaseUrl: normalizeApiBaseUrl(app?.apiBaseUrl),
    panelSlug: app?.panelSlug,
  });
  if (resolved) return resolved;

  return (
    deriveBaseFromLegacyUrl(app?.healthApiUrl) ||
    deriveBaseFromLegacyUrl(app?.analyseApiUrl) ||
    deriveBaseFromLegacyUrl(app?.usersApiUrl) ||
    null
  );
}

function buildAppApiEndpoints(app) {
  const base = resolveApiBaseUrl(app);
  if (!base) {
    return {
      base: null,
      health: null,
      analyse: null,
      users: null,
      agents: null,
      agentsOptions: null,
      personas: null,
      personasOptions: null,
      purchases: null,
      workouts: null,
      userWorkouts: null,
      metadataCategories: null,
      tutors: null,
      homeworkImages: null,
      chats: null,
      translations: null,
      logs: null,
      menus: null,
      templates: null,
      stories: null,
      courses: null,
      lessons: null,
      phrases: null,
      activities: null,
      items: null,
      languages: null,
      voices: null,
      sections: null,
      options: null,
      projects: null,
      reviews: null,
      brands: null,
      posts: null,
      documents: null,
      summaries: null,
      subscriptions: null,
      tracks: null,
      words: null,
      tasks: null,
      routines: null,
      events: null,
      moods: null,
      artists: null,
      gameSessions: null,
      chipPurchases: null,
      podcasts: null,
      episodes: null,
      playlists: null,
      liveSessions: null,
      sleepSessions: null,
      notifications: null,
      premiumUserIds: null
    };
  }

  return {
    base,
    health: joinApiPath(base, "/health"),
    analyse: joinApiPath(base, "/analyse"),
    users: joinApiPath(base, "/users"),
    premiumUserIds: joinApiPath(base, "/users/premium-ids"),
    homeworkImages: joinApiPath(base, "/homework-images"),
    chats: joinApiPath(base, "/chats"),
    translations: joinApiPath(base, "/translations"),
    logs: joinApiPath(base, "/logs"),
    menus: joinApiPath(base, "/menus"),
    templates: joinApiPath(base, "/templates"),
    stories: joinApiPath(base, "/stories"),
    courses: joinApiPath(base, "/courses"),
    lessons: joinApiPath(base, "/lessons"),
    phrases: joinApiPath(base, "/phrases"),
    activities: joinApiPath(base, "/activities"),
    items: joinApiPath(base, "/items"),
    languages: joinApiPath(base, "/languages"),
    voices: joinApiPath(base, "/voices"),
    sections: joinApiPath(base, "/sections"),
    options: joinApiPath(base, "/options"),
    projects: joinApiPath(base, "/projects"),
    reviews: joinApiPath(base, "/reviews"),
    brands: joinApiPath(base, "/brands"),
    posts: joinApiPath(base, "/posts"),
    documents: joinApiPath(base, "/documents"),
    summaries: joinApiPath(base, "/summaries"),
    subscriptions: joinApiPath(base, "/subscriptions"),
    tracks: joinApiPath(base, "/tracks"),
    words: joinApiPath(base, "/words"),
    tasks: joinApiPath(base, "/tasks"),
    routines: joinApiPath(base, "/routines"),
    events: joinApiPath(base, "/events"),
    moods: joinApiPath(base, "/moods"),
    artists: joinApiPath(base, "/artists"),
    gameSessions: joinApiPath(base, "/game-sessions"),
    chipPurchases: joinApiPath(base, "/chip-purchases"),
    podcasts: joinApiPath(base, "/podcasts"),
    episodes: joinApiPath(base, "/episodes"),
    playlists: joinApiPath(base, "/playlists"),
    liveSessions: joinApiPath(base, "/live-sessions"),
    sleepSessions: joinApiPath(base, "/sleep-sessions"),
    tutors: joinApiPath(base, "/tutors"),
    agents: joinApiPath(base, "/agents"),
    agentsOptions: joinApiPath(base, "/agents/options"),
    personas: joinApiPath(base, "/personas"),
    personasOptions: joinApiPath(base, "/personas/options"),
    purchases: joinApiPath(base, "/purchases"),
    notifications: joinApiPath(base, "/notifications"),
    workouts: joinApiPath(base, "/workouts"),
    userWorkouts: joinApiPath(base, "/user-workouts"),
    metadataCategories: joinApiPath(base, "/metadata/categories")
  };
}

module.exports = {
  normalizeApiBaseUrl,
  joinApiPath,
  resolveApiBaseUrl,
  buildAppApiEndpoints
};
