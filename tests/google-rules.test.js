import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";
import { sealSecret, openSecret } from "@/server/google/cipher";
import { DRIVE_FILE_SCOPE, GMAIL_READONLY_SCOPE, grantedScopesCover } from "@/server/google/config";
import { GMAIL_QUERIES, listMessageIds } from "@/server/google/gmail";
import { buildAuthorizationUrl, createOAuthState, oauthStatesMatch, refreshAccessToken } from "@/server/google/oauth";
import { disconnectGoogleAccount, prepareGoogleConnect } from "@/server/services/googleLink";

loadEnvConfig(process.cwd());

const config = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:3010/api/google/oauth/callback",
  missing: [] ,
  configured: true,
};

const employee = {
  id: "faz8-yok",
  role: "EMPLOYEE",
  email: "faz8-calisan@example.invalid",
  name: "Faz8 Calisan",
};

describe("google oauth kuralları", () => {
  it("yalnızca gmail okuma ve drive dosya iznini ister", () => {
    const url = new URL(buildAuthorizationUrl("durum-faz8", config));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([GMAIL_READONLY_SCOPE, DRIVE_FILE_SCOPE]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(grantedScopesCover(`${GMAIL_READONLY_SCOPE} ${DRIVE_FILE_SCOPE}`)).toBe(true);
    expect(grantedScopesCover("https://www.googleapis.com/auth/gmail.modify")).toBe(false);
  });

  it("oauth durumunu ve token şifresini doğrular", () => {
    const state = createOAuthState();
    expect(oauthStatesMatch(state, state)).toBe(true);
    expect(oauthStatesMatch(state, `${state}x`)).toBe(false);
    expect(oauthStatesMatch("abc", "abd")).toBe(false);
    const sealed = sealSecret("PLAINTEXT-TOKEN-XYZ");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("PLAINTEXT-TOKEN-XYZ");
    expect(openSecret(sealed)).toBe("PLAINTEXT-TOKEN-XYZ");
  });

  it("token hata metnine gizli değeri yazmaz", async () => {
    const secret = "super-refresh-secret";
    const failure = refreshAccessToken(
      secret,
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant", error_description: secret }), { status: 400 }),
      config,
    );
    await expect(failure).rejects.toThrow(/yenilenemedi/);
    await expect(failure).rejects.not.toThrow(secret);
  });

  it("gmail listelemesini sayfa belirteci bitene kadar sürdürür", async () => {
    const seen = [];
    const ids = await listMessageIds(
      {
        async listMessages(query, pageToken) {
          expect(query).toBe(GMAIL_QUERIES.important);
          seen.push(pageToken);
          if (!pageToken) {
            return {
              messages: [
                { id: "faz8-a", threadId: "t" },
                { id: "faz8-b", threadId: "t" },
              ],
              nextPageToken: "sayfa-2",
            };
          }
          return { messages: [{ id: "faz8-c", threadId: "t" }] };
        },
      },
      GMAIL_QUERIES.important,
      10,
    );
    expect(seen).toEqual([undefined, "sayfa-2"]);
    expect(ids).toEqual(["faz8-a", "faz8-b", "faz8-c"]);
  });

  it("çalışanın google bağlamasını reddeder", async () => {
    expect(() => prepareGoogleConnect(employee)).toThrow(AppError);
    await expect(disconnectGoogleAccount(employee)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
