import { loadEnvConfig } from "@next/env";
import Module from "node:module";

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

loadEnvConfig(process.cwd());

const { PrismaClient } = await import("../src/generated/prisma/client");
const { createMysqlAdapter } = await import("../src/server/mysql");
const {
  collectWeeklyWorkReport,
  renderWeeklyWorkReportText,
  sendWeeklyWorkReport,
} = await import("../src/server/work/weeklyReport");

const preview = process.argv.includes("--preview");
const toArg = process.argv.find((item) => item.startsWith("--to="));
const to = toArg
  ? toArg.slice(5).split(",").map((item) => item.trim()).filter(Boolean)
  : undefined;

if (!process.env.DATABASE_URL) {
  console.error("Eksik ortam değişkeni: DATABASE_URL");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: createMysqlAdapter() });

try {
  if (preview) {
    const report = await collectWeeklyWorkReport(prisma, new Date());
    console.log(renderWeeklyWorkReportText(report, null));
  } else {
    const result = await sendWeeklyWorkReport(prisma, new Date(), to ? { to } : {});
    console.log(result.summary);
    if (result.state !== "SUCCEEDED") process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
