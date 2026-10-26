import { loadEnvConfig } from "@next/env";
import { defineConfig, env } from "prisma/config";

loadEnvConfig(process.cwd());

const config = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

export default config;
