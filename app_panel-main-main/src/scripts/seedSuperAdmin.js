const bcrypt = require("bcryptjs");

const env = require("../config/env");
const { pool } = require("../config/db");

async function seed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('SUPER_ADMIN', 'ADMIN', 'USER') NOT NULL DEFAULT 'USER',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [rows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [env.superAdmin.email]);
  if (rows.length > 0) {
    console.log("Super Admin zaten mevcut.");
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(env.superAdmin.password, 10);

  await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'SUPER_ADMIN')",
    [env.superAdmin.name, env.superAdmin.email, passwordHash]
  );

  console.log("Super Admin olusturuldu.");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed hatasi:", error.message);
  process.exit(1);
});
