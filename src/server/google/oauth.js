import { randomBytes, timingSafeEqual } from "node:crypto";
import { GOOGLE_OAUTH_SCOPES, googleEnv } from "@/server/google/config";
import { AppError } from "@/server/errors";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

 






export class GoogleOAuthError extends Error {
   kind;

  constructor(kind, message) {
    super(message);
    this.name = "GoogleOAuthError";
    this.kind = kind;
  }
}

export function createOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function oauthStatesMatch(expected, received) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function buildAuthorizationUrl(state, config = googleEnv()) {
  if (!config.configured) {
    throw new AppError(
      `Google kimlik bilgileri eksik. Bağlantı kurulmadı. Eksik: ${config.missing.join(", ")}.`,
      "CONFIG",
      503,
    );
  }
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function postForm(
  url,
  body,
  fetchImpl,
) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return readErrorPayload(payload);
  }
  return payload;
}

function readErrorPayload(payload) {
  const errorCode =
    payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "";
  if (errorCode === "invalid_grant") {
    throw new GoogleOAuthError("invalid_grant", "Google erişim anahtarı yenilenemedi.");
  }
  throw new GoogleOAuthError("exchange", "Google token isteği reddedildi.");
}

function readTokens(payload, requireRefresh) {
  if (!payload || typeof payload !== "object") {
    throw new GoogleOAuthError("exchange", "Google token yanıtı okunamadı.");
  }
  if ("error" in payload) {
    readErrorPayload(payload);
  }
  const record = payload ;
  if (typeof record.access_token !== "string" || typeof record.expires_in !== "number") {
    throw new GoogleOAuthError("exchange", "Google token yanıtı eksik.");
  }
  const refreshToken = typeof record.refresh_token === "string" ? record.refresh_token : undefined;
  if (requireRefresh && !refreshToken) {
    throw new GoogleOAuthError("exchange", "Google yenileme anahtarı vermedi. Bağlantı kaydedilmedi.");
  }
  return {
    accessToken: record.access_token,
    expiresIn: record.expires_in,
    refreshToken,
    scope: typeof record.scope === "string" ? record.scope : "",
  };
}

export async function exchangeAuthorizationCode(
  code,
  fetchImpl = fetch,
  config = googleEnv(),
) {
  if (!config.configured) {
    throw new AppError("Google kimlik bilgileri eksik. Bağlantı kurulmadı.", "CONFIG", 503);
  }
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  return readTokens(await postForm(TOKEN_URL, body, fetchImpl), true);
}

export async function refreshAccessToken(
  refreshToken,
  fetchImpl = fetch,
  config = googleEnv(),
) {
  if (!config.configured) {
    throw new AppError("Google kimlik bilgileri eksik.", "CONFIG", 503);
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  return readTokens(await postForm(TOKEN_URL, body, fetchImpl), false);
}

export async function revokeRefreshToken(
  refreshToken,
  fetchImpl = fetch,
) {
  const body = new URLSearchParams({ token: refreshToken });
  await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }).catch(() => undefined);
}
