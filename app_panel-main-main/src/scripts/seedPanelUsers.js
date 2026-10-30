const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");

const DEMO_USERS = [
  {
    name: "Panel Admin",
    email: "admin@app-panel.local",
    password: "Admin123!",
    role: "ADMIN"
  },
  {
    name: "Panel Kullanici",
    email: "user@app-panel.local",
    password: "Admin123!",
    role: "USER"
  }
];

async function seed() {
  for (const user of DEMO_USERS) {
    const [rows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [user.email]);
    if (rows.length > 0) {
      console.log(`${user.email} zaten mevcut.`);
      continue;
    }

    const passwordHash = await bcrypt.hash(user.password, 10);
    await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [user.name, user.email, passwordHash, user.role]
    );
    console.log(`${user.role} olusturuldu: ${user.email}`);
  }

  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed hatasi:", error.message);
  process.exit(1);
});
