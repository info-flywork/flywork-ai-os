export const PANEL_PREFIX = "/uygulama-paneli";

const QUOTED_ROOT = /(["'`])\/(api|css|js|assets|panel|apps|login\.html)/g;
const CSS_URL = /url\(\s*(["']?)\/(css|js|assets)\//g;

export function prefixPanelPaths(text) {
  return String(text)
    .replace(QUOTED_ROOT, `$1${PANEL_PREFIX}/$2`)
    .replace(CSS_URL, `url($1${PANEL_PREFIX}/$2/`);
}

export function prefixPanelLocation(location) {
  if (!location || !location.startsWith("/")) return location;
  if (location === PANEL_PREFIX || location.startsWith(`${PANEL_PREFIX}/`)) return location;
  return `${PANEL_PREFIX}${location}`;
}
