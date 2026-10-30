import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMysqlAdapter } from "../src/server/mysql";
import { drainDueJobs, ensureAutomationJobs } from "../src/server/automation/engine";
import { remindWorkDeadlines } from "../src/server/work/reminders";
import { holdWorkerLock } from "../src/server/automation/singleton";
import { assertProductionEnv } from "../src/server/runtime/productionEnv";
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  console.error("Eksik ortam değişkeni: DATABASE_URL");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: createMysqlAdapter(),
});

let stopping = false;
let releaseLock = null;

function stopWorker() {
  stopping = true;
}

process.on("SIGINT", stopWorker);
process.on("SIGTERM", stopWorker);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const workerMarker = Symbol.for("flywork.automation.worker");

try {
  if (globalThis[workerMarker]) {
    console.info("Zamanlayıcı bu süreçte zaten kayıtlı. İkinci kayıt atlandı.");
    process.exit(0);
  }
  globalThis[workerMarker] = true;
  assertProductionEnv();
  const lock = await holdWorkerLock(process.env.DATABASE_URL);
  if (!lock) {
    console.error("Otomasyon worker zaten çalışıyor. İkinci süreç açılmadı.");
    process.exit(0);
  }
  releaseLock = lock.release;
  await ensureAutomationJobs(prisma, new Date());
  console.log("Zamanlayıcı bir kez kaydedildi. Aralık 15 sn. Saat dilimi Europe/Istanbul.");
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
