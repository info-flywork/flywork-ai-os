import { aiDocumentEnv } from "@/server/finance/documentAi";
import { googleConnectionReport } from "@/server/finance/google";
import { telegramStatus } from "@/server/telegram/config";

const EMAIL = ["SMTP_HOST", "SMTP_FROM"] ;

function missing(names) {
  return names.filter((name) => !process.env[name]);
}

 













export function connectionReport(link) {
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
