const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DEFAULT_CREDENTIAL_PATH = path.join(
  PROJECT_ROOT,
  "secrets",
  "yogify-service-account.json"
);

let yogifyApp = null;

function resolveCredentialPath() {
  const fromEnv = String(process.env.YOGIFY_FIREBASE_CREDENTIALS || "").trim();
  if (!fromEnv) return DEFAULT_CREDENTIAL_PATH;
  if (path.isAbsolute(fromEnv)) return fromEnv;

  // PM2 cwd çoğu zaman proje kökü değil; relative path'i proje köküne göre çöz.
  const fromProjectRoot = path.resolve(PROJECT_ROOT, fromEnv);
  if (fs.existsSync(fromProjectRoot)) return fromProjectRoot;

  const fromCwd = path.resolve(process.cwd(), fromEnv);
  if (fs.existsSync(fromCwd)) return fromCwd;

  return fromProjectRoot;
}

function getYogifyFirebase() {
  if (yogifyApp) {
    return {
      app: yogifyApp,
      db: getFirestore(yogifyApp),
      auth: getAuth(yogifyApp),
      projectId: yogifyApp.options.projectId
    };
  }

  const credentialPath = resolveCredentialPath();
  if (!fs.existsSync(credentialPath)) {
    const error = new Error(
      `Yogify Firebase service account bulunamadi: ${credentialPath} (cwd=${process.cwd()})`
    );
    error.code = "YOGIFY_FIREBASE_MISSING";
    throw error;
  }

  const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
  const appName = "yogify-panel";

  try {
    yogifyApp = admin.app(appName);
  } catch {
    const credential =
      typeof admin.credential?.cert === "function"
        ? admin.credential.cert(serviceAccount)
        : admin.cert(serviceAccount);

    yogifyApp = admin.initializeApp(
      {
        credential,
        projectId: serviceAccount.project_id,
        storageBucket:
          process.env.YOGIFY_FIREBASE_STORAGE_BUCKET ||
          `${serviceAccount.project_id}.firebasestorage.app`
      },
      appName
    );
  }

  return {
    app: yogifyApp,
    db: getFirestore(yogifyApp),
    auth: getAuth(yogifyApp),
    projectId: serviceAccount.project_id || yogifyApp.options.projectId
  };
}

function isYogifyFirebaseConfigured() {
  try {
    return fs.existsSync(resolveCredentialPath());
  } catch {
    return false;
  }
}

module.exports = {
  getYogifyFirebase,
  isYogifyFirebaseConfigured,
  resolveCredentialPath
};
