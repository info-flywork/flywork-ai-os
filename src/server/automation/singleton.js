import mariadb from "mariadb";
import { mysqlConnectionOptions } from "@/server/mysql";

export const WORKER_LOCK_KEY = 748221;

export async function holdWorkerLock(
  connectionString,
  key = WORKER_LOCK_KEY,
) {
  const name = `flywork-worker-${key}`.slice(0, 64);
  const { connectionLimit: _limit, ...options } = mysqlConnectionOptions(connectionString);
  const connection = await mariadb.createConnection(options);
  try {
    const rows = await connection.query(
      "SELECT GET_LOCK(?, 0) AS locked",
      [name],
    );
    if (Number(rows[0]?.locked) !== 1) {
      await connection.end();
      return null;
    }
  } catch (error) {
    await connection.end().catch(() => undefined);
    throw error;
  }

  return {
    release: async () => {
      await connection.query("SELECT RELEASE_LOCK(?)", [name]).catch(() => undefined);
      await connection.end().catch(() => undefined);
    },
  };
}
