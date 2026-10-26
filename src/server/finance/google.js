import { DRIVE_FILE_SCOPE, GMAIL_READONLY_SCOPE, GOOGLE_REDIRECT_PATH, googleEnv } from "@/server/google/config";
import { AppError } from "@/server/errors";

 






















export function googleConnectionReport(link) {
  const env = googleEnv();
  const connected = Boolean(env.configured && link?.connected && link.status === "CONNECTED");
  let status = "DISCONNECTED";
  if (!env.configured) {
    status = "UNCONFIGURED";
  } else if (link?.status === "ERROR") {
    status = "ERROR";
  } else if (connected) {
    status = "CONNECTED";
  }
  return {
    connected,
    oauthImplemented: true,
    credentialsConfigured: env.configured,
    accountEmail: link?.email ?? null,
    status,
    lastError: connected ? null : link?.lastError ?? null,
    missing: env.missing,
    gmailScope: GMAIL_READONLY_SCOPE,
    driveScope: DRIVE_FILE_SCOPE,
    redirectUri: env.redirectUri || null,
    redirectPath: GOOGLE_REDIRECT_PATH,
    archivePattern: "Flywork/Faturalar/{yil}/{ay}/{tedarikci}-{fatura-no}.pdf",
    excludedDocuments: ["e-posta yazışması", "teklif", "proforma", "CV"],
  };
}

export function planDriveArchive(input



) {
  const [year, month] = input.issuedOn.split("-");
  const vendor = input.vendor
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const number = input.number.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40);
  return {
    folder: `Flywork/Faturalar/${year}/${month}`,
    fileName: `${vendor || "tedarikci"}-${number || "fatura"}.pdf`,
  };
}

export function scanGmailInvoices() {
  const report = googleConnectionReport();
  const missing = report.missing.length > 0 ? ` Eksik: ${report.missing.join(", ")}.` : "";
  throw new AppError(
    `Gmail taraması çalıştırılmadı. Posta okunmadı ve dosya Drive'a yüklenmedi.${missing}`,
    "CONFIG",
    503,
  );
}
