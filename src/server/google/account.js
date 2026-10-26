
import { stringList } from "@/server/jsonList";
import { openSecret, sealSecret } from "@/server/google/cipher";
import { googleEnv, grantedScopesCover } from "@/server/google/config";
import { createGmailApi } from "@/server/google/gmail";
import {
  exchangeAuthorizationCode,
  GoogleOAuthError,
  refreshAccessToken,
  revokeRefreshToken,
} from "@/server/google/oauth";


const ACCOUNT_ID = "default";
const SKEW_MS = 60_000;

 









export async function readGoogleLink(db) {
  const env = googleEnv();
  const account = await db.googleAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!env.configured) {
    return {
      configured: false,
      connected: false,
      status: "UNCONFIGURED",
      email: account?.email ?? null,
      lastError: null,
      missing: env.missing,
      scopes: stringList(account?.scopes),
    };
  }
  if (!account) {
    return {
      configured: true,
      connected: false,
      status: "DISCONNECTED",
      email: null,
      lastError: null,
      missing: [],
      scopes: [],
    };
  }
  if (account.status !== "CONNECTED") {
    return {
      configured: true,
      connected: false,
      status: "ERROR",
      email: account.email,
      lastError: account.lastError,
      missing: [],
      scopes: stringList(account.scopes),
    };
  }
  return {
    configured: true,
    connected: true,
    status: "CONNECTED",
    email: account.email,
    lastError: null,
    missing: [],
    scopes: stringList(account.scopes),
  };
}

export async function connectFromAuthorizationCode(
  db,
  input,
  fetchImpl = fetch,
  config,
) {
  const tokens = await exchangeAuthorizationCode(input.code, fetchImpl, config);
  if (!grantedScopesCover(tokens.scope)) {
    throw new GoogleOAuthError(
      "exchange",
      "Google eksik izin verdi. Gmail okuma ve Drive dosya izni olmadan bağlantı kaydedilmedi.",
    );
  }
  const profile = await createGmailApi(tokens.accessToken, fetchImpl).profile();
  const refreshToken = tokens.refreshToken;
  if (!refreshToken) {
    throw new GoogleOAuthError("exchange", "Google yenileme anahtarı vermedi. Bağlantı kaydedilmedi.");
  }
  await db.googleAccount.upsert({
    where: { id: ACCOUNT_ID },
    create: {
      id: ACCOUNT_ID,
      email: profile.emailAddress,
      scopes: tokens.scope.split(/\s+/).filter(Boolean),
      refreshTokenCipher: sealSecret(refreshToken),
      accessTokenCipher: sealSecret(tokens.accessToken),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      status: "CONNECTED",
      lastError: null,
      connectedById: input.connectedById,
    },
    update: {
      email: profile.emailAddress,
      scopes: tokens.scope.split(/\s+/).filter(Boolean),
      refreshTokenCipher: sealSecret(refreshToken),
      accessTokenCipher: sealSecret(tokens.accessToken),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      status: "CONNECTED",
      lastError: null,
      connectedById: input.connectedById,
    },
  });
  return { email: profile.emailAddress };
}

export async function accessTokenFor(
  db,
  fetchImpl = fetch,
  config = googleEnv(),
) {
  const env = config;
  if (!env.configured) {
    return null;
  }
  const account = await db.googleAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!account || account.status !== "CONNECTED") {
    return null;
  }
  const refreshToken = openSecret(account.refreshTokenCipher);
  if (!refreshToken) {
    await db.googleAccount.update({
      where: { id: ACCOUNT_ID },
      data: {
        status: "ERROR",
        lastError: "Kayıtlı Google anahtarı okunamadı. Hesabı yeniden bağlayın.",
        accessTokenCipher: null,
        accessTokenExpiresAt: null,
      },
    });
    return null;
  }
  const stillValid =
    account.accessTokenCipher &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() > Date.now() + SKEW_MS;
  if (stillValid && account.accessTokenCipher) {
    const current = openSecret(account.accessTokenCipher);
    if (current) {
      return { token: current, email: account.email };
    }
  }
  try {
    const refreshed = await refreshAccessToken(refreshToken, fetchImpl, env);
    await db.googleAccount.update({
      where: { id: ACCOUNT_ID },
      data: {
        accessTokenCipher: sealSecret(refreshed.accessToken),
        accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        refreshTokenCipher: refreshed.refreshToken ? sealSecret(refreshed.refreshToken) : undefined,
        status: "CONNECTED",
        lastError: null,
      },
    });
    return { token: refreshed.accessToken, email: account.email };
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.kind === "invalid_grant") {
      await db.googleAccount.update({
        where: { id: ACCOUNT_ID },
        data: {
          status: "ERROR",
          lastError: "Google erişimi yenilenemedi. Hesabı yeniden bağlayın.",
          accessTokenCipher: null,
          accessTokenExpiresAt: null,
          refreshTokenCipher: sealSecret(""),
        },
      });
      return null;
    }
    throw error;
  }
}

export async function disconnectGoogle(db, fetchImpl = fetch) {
  const account = await db.googleAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!account) {
    return false;
  }
  const refreshToken = openSecret(account.refreshTokenCipher);
  if (refreshToken) {
    await revokeRefreshToken(refreshToken, fetchImpl);
  }
  await db.googleAccount.delete({ where: { id: ACCOUNT_ID } });
  return true;
}
