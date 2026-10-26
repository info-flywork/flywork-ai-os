import { loadEnvConfig } from "@next/env";
import { registerTelegramWebhook } from "../src/server/telegram/webhookSetup";

loadEnvConfig(process.cwd());

async function main() {
  const report = await registerTelegramWebhook(process.env, process.argv.slice(2));
  console.log(JSON.stringify({
    mode: report.mode,
    registered: report.registered,
    tokenPresent: report.tokenPresent,
    secretPresent: report.secretPresent,
    urlReady: report.urlReady,
    deliveryOff: report.deliveryOff,
    missing: report.missing,
  }));
  if (report.mode === "apply" && !report.registered) {
    process.exitCode = 1;
  }
}

void main();
