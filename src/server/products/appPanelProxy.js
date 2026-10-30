import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

const UPSTREAM = "https://apppanel.fly-work.com";
let serviceToken = "";
let serviceTokenUntil = 0;

export function isAppPanelHost(host) {
  return (host ?? "").split(":")[0] === "apppanel.localhost";
}

export function rewriteTokenCookie(cookie) {
  const name = cookie.split("=")[0]?.trim().toLowerCase();
  if (name !== "token") return null;
  let next = cookie.replace(/;\s*samesite=[^;]*/i, "; SameSite=None");
  if (!/;\s*samesite=/i.test(next)) next += "; SameSite=None";
  if (!/;\s*secure\b/i.test(next)) next += "; Secure";
  if (!/;\s*path=/i.test(next)) next += "; Path=/";
  return next;
}

export function upstreamUrl(segments, search) {
  const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${UPSTREAM}/${path}${search || ""}`;
}

export function upstreamLocation(location) {
  if (!location) return null;
  if (location.startsWith(UPSTREAM)) return location.slice(UPSTREAM.length) || "/";
  return location;
}

function panelCredentials() {
  const file = readFileSync(path.join(process.cwd(), "app_panel-main-main", ".env"), "utf8");
  const env = {};
  for (const line of file.split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    env[key] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { email: env.SUPER_ADMIN_EMAIL ?? "", password: env.SUPER_ADMIN_PASSWORD ?? "" };
}

function tokenFromCookies(cookies) {
  const raw = cookies.find((cookie) => cookie.toLowerCase().startsWith("token="));
  if (!raw) return "";
  return raw.slice("token=".length).split(";")[0] ?? "";
}

export async function getServiceToken(force = false) {
  if (!force && serviceToken && Date.now() < serviceTokenUntil) return serviceToken;
  const { email, password } = panelCredentials();
  if (!email || !password) return "";
  const response = await fetch(`${UPSTREAM}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
    redirect: "manual",
  });
  if (!response.ok) {
    serviceToken = "";
    serviceTokenUntil = 0;
    return "";
  }
  const token = tokenFromCookies(response.headers.getSetCookie?.() ?? []);
  if (!token) return "";
  serviceToken = token;
  serviceTokenUntil = Date.now() + 12 * 60 * 60 * 1000;
  return token;
}

