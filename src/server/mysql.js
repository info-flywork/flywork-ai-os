import { PrismaMariaDb } from "@prisma/adapter-mariadb";

export function mysqlConnectionOptions(connectionString = process.env.DATABASE_URL) {
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL yok.");
  }
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    connectTimeout: 20_000,
  };
}

export function createMysqlAdapter(connectionString = process.env.DATABASE_URL) {
  return new PrismaMariaDb({
    ...mysqlConnectionOptions(connectionString),
    connectionLimit: 10,
    minimumIdle: 1,
    acquireTimeout: 20_000,
  });
}
