const mysql = require("mysql2/promise");
const env = require("./env");

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4"
});

async function testDbConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    await connection.query("SELECT 1");
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  testDbConnection
};
