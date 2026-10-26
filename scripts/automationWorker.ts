import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMysqlAdapter } from "../src/server/mysql";
import { drainDueJobs, ensureAutomationJobs } from "../src/server/automation/engine";
import { remindWorkDeadlines } from "../src/server/work/reminders";
import { holdWorkerLock } from "../src/server/automation/singleton";
import { assertProductionEnv } from "../src/server/runtime/productionEnv";
import { localTelegramPollEnabled, runLocalTelegramPoll } from "../src/server/telegram/poll";

loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  console.error("Eksik ortam değişkeni: DATABASE_URL");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: createMysqlAdapter(),
});

let stopping = false;
let releaseLock: (() => Promise<void>) | null = null;
const telegramPoll = new AbortController();

function stopWorker() {
  stopping = true;
  telegramPoll.abort();
}

process.on("SIGINT", stopWorker);
process.on("SIGTERM", stopWorker);

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  assertProductionEnv();
  const lock = await holdWorkerLock(process.env.DATABASE_URL);
  if (!lock) {
    console.error("Otomasyon worker zaten çalışıyor. İkinci süreç açılmadı.");
    process.exit(0);
  }
  releaseLock = lock.release;
  await ensureAutomationJobs(prisma, new Date());
  console.log("Otomasyon worker başladı. Aralık 15 sn. Saat dilimi Europe/Istanbul.");
  if (localTelegramPollEnabled(process.env)) {
    const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
    void runLocalTelegramPoll({
      token,
      secret,
      endpoint: "http://127.0.0.1:3010/api/telegram/webhook",
      shouldStop: () => stopping,
      signal: telegramPoll.signal,
    }).catch(() => {
      console.error("Telegram gelen kutusu okunamadı.");
    });
  }
  while (!stopping) {
    const ran = await drainDueJobs(prisma, new Date());
    if (ran > 0) {
      console.log(`${ran} görev penceresi işlendi.`);
    }
    await remindWorkDeadlines(prisma, new Date()).catch(() => {
      console.error("Görev süre hatırlatması gönderilemedi.");
    });
    await sleep(15_000);
  }
} finally {
  await releaseLock?.();
  await prisma.$disconnect();
}
