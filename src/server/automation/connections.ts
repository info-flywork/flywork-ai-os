import { aiDocumentEnv } from "@/server/finance/documentAi";
import { googleConnectionReport, type GoogleLinkSnapshot } from "@/server/finance/google";
import { telegramStatus } from "@/server/telegram/config";

const EMAIL = ["SMTP_HOST", "SMTP_FROM"] as const;

function missing(names: readonly string[]) {
  return names.filter((name) => !process.env[name]);
}

export type ConnectionReport = {
  gmail: {
    connected: boolean;
    oauthImplemented: true;
    missing: string[];
    email: string | null;
    status: GoogleLinkSnapshot["status"];
  };
  drive: { connected: boolean; archiveReady: boolean; missing: string[] };
  ai: { configured: boolean; provider: string | null; missing: string[] };
  telegram: { configured: boolean; delivery: "off" | "live"; delivered: false; missing: string[] };
  email: { connected: false; delivered: false; missing: string[] };
};

export function connectionReport(link?: GoogleLinkSnapshot | null): ConnectionReport {
  const google = googleConnectionReport(link);
  return {
    gmail: {
      connected: google.connected,
      oauthImplemented: true,
      missing: google.missing,
      email: google.accountEmail,
      status: google.status,
    },
    drive: {
      connected: google.connected,
      archiveReady: google.connected,
      missing: google.missing,
    },
    ai: aiDocumentEnv(),
    telegram: { ...telegramStatus(), delivered: false },
    email: { connected: false, delivered: false, missing: missing(EMAIL) },
  };
}
