import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMysqlAdapter } from "../src/server/mysql";
import { createInitialAdmin } from "../src/server/auth/bootstrap";
import { AppError } from "../src/server/errors";

loadEnvConfig(process.cwd());

const missing = ["ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"].filter(
  (key) => !process.env[key]?.trim(),
);

if (!process.env.DATABASE_URL) {
  missing.push("DATABASE_URL");
}

if (missing.length > 0) {
  console.error(`Eksik ortam değişkenleri: ${missing.join(", ")}`);
  console.error(
    "Örnek: ADMIN_NAME=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create",
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: createMysqlAdapter(),
});

try {
  const admin = await createInitialAdmin(prisma, {
    name: process.env.ADMIN_NAME,
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  console.log(`Yönetici oluşturuldu: ${admin.email}`);
} catch (error) {
  if (error instanceof AppError) {
    console.error(error.message);
  } else {
    console.error("Yönetici oluşturulamadı.");
  }
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
