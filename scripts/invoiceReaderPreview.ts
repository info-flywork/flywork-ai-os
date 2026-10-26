import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMysqlAdapter } from "../src/server/mysql";
import { runControlledInvoicePreview } from "../src/server/finance/invoicePreview";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: createMysqlAdapter(),
});

const report = await runControlledInvoicePreview(prisma);
console.log(JSON.stringify(report));
await prisma.$disconnect();
