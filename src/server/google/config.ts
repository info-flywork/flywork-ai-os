export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_OAUTH_SCOPES = [GMAIL_READONLY_SCOPE, DRIVE_FILE_SCOPE] as const;
export const GOOGLE_REDIRECT_PATH = "/api/google/oauth/callback";

const ENV_NAMES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const;

export type GoogleEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  missing: string[];
  configured: boolean;
};

export function googleEnv(): GoogleEnv {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() ?? "";
  const missing = ENV_NAMES.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === "";
  });
  return {
    clientId,
    clientSecret,
    redirectUri,
    missing: [...missing],
    configured: missing.length === 0,
  };
}

export function grantedScopesCover(scope: string): boolean {
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  return GOOGLE_OAUTH_SCOPES.every((required) => granted.has(required));
}
