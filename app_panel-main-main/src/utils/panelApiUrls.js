/**
 * Production panel API base URLs by panel_slug.
 * Used when applications.api_base_url points to localhost.
 */
const PRODUCTION_PANEL_API_URLS = {
  "live-lingola": "https://livelingolaapp.fly-work.com/panel/v1",
  menuma: "https://menuma.fly-work.com/panel/v1",
  slidify: "https://slidify.fly-work.com/panel/v1",
  smplanner: "https://smplanner.fly-work.com/panel/v1",
  filetranslate: "https://filetranslate.fly-work.com/panel/v1",
  videosummary: "https://videosummary.fly-work.com/panel/v1",
  filechat: "https://filechat.fly-work.com/panel/v1",
  homifit: "https://homifit.fly-work.com/panel/v1",
  fitgym: "https://fitgym.fly-work.com/panel/v1",
  momfit: "https://momfit.fly-work.com/panel",
  signivo: "https://signivov2.fly-work.com/panel",
  lingolawords: "https://lingoladailywords.fly-work.com/panel",
  storylang: "https://lingolastories.fly-work.com/panel/v1",
  lingolatravel: "https://lingolatravel.fly-work.com/panel/v1",
  lingolakids: "https://lingolakids.fly-work.com/panel/v1",
  storieskids: "https://lingolastorieskids.fly-work.com/panel/v1",
  lingolajob: "https://lingolajob.fly-work.com/panel/v1",
  dayflow: "https://dayflow.fly-work.com/panel/v1",
  practigram: "https://practigram.fly-work.com/panel/v1",
  podora: "https://podora.fly-work.com/panel/v1",
  logora: "https://logora.fly-work.com/panel/v1",
  pdfology: "https://pdfology.fly-work.com/panel/v1",
  sixpack30: "https://sixpack30.fly-work.com/panel",
};

function isLocalApiUrl(value) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function getProductionPanelApiUrl(panelSlug) {
  const slug = String(panelSlug || "").trim().toLowerCase();
  if (!slug) return null;
  return PRODUCTION_PANEL_API_URLS[slug] || null;
}

/** Eski/yanlış panel hostları — DB'de kalsa bile canonical production URL kullanılır. */
const STALE_PANEL_HOSTS_BY_SLUG = {
  fitgym: ["fitness.duyari.com.tr"],
  sixpack30: ["api.sixpack30.com"],
  signivo: ["signivo-v2.fly-work.com"],
};

function isStalePanelApiUrl(storedUrl, panelSlug) {
  const slug = String(panelSlug || "").trim().toLowerCase();
  const hosts = STALE_PANEL_HOSTS_BY_SLUG[slug];
  if (!storedUrl || !hosts?.length) return false;
  try {
    const host = new URL(storedUrl).hostname.toLowerCase();
    return hosts.some((stale) => host === stale || host.endsWith(`.${stale}`));
  } catch {
    return false;
  }
}

function resolvePanelApiBaseUrl(app) {
  const stored = app?.apiBaseUrl;
  const production = getProductionPanelApiUrl(app?.panelSlug);

  if (stored && !isLocalApiUrl(stored)) {
    if (production && isStalePanelApiUrl(stored, app?.panelSlug)) {
      return production;
    }
    return stored;
  }
  if (production) {
    return production;
  }
  return stored || null;
}

module.exports = {
  PRODUCTION_PANEL_API_URLS,
  isLocalApiUrl,
  getProductionPanelApiUrl,
  resolvePanelApiBaseUrl,
};
