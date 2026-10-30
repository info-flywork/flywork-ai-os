const env = require("../config/env");

function isEnabled() {
  return (
    env.revenuecatDebug ||
    env.nodeEnv === "development" ||
    process.env.REVENUECAT_DEBUG === "true" ||
    process.env.REVENUECAT_DEBUG === "1"
  );
}

function maskSecret(value) {
  if (!value) return "(yok)";
  const s = String(value);
  if (s.length <= 8) return "***";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function maskProjectId(value) {
  if (!value) return "(yok)";
  const s = String(value);
  if (s.length <= 10) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function rcLog(event, meta = {}) {
  if (!isEnabled()) return;

  const line = {
    ts: new Date().toISOString(),
    scope: "revenuecat",
    event,
    ...meta
  };

  if (line.apiKey) line.apiKey = maskSecret(line.apiKey);
  if (line.projectId) line.projectId = maskProjectId(line.projectId);

  console.log("[RevenueCat]", JSON.stringify(line));
}

module.exports = {
  isRevenueCatDebugEnabled: isEnabled,
  rcLog,
  maskSecret,
  maskProjectId
};
