#!/usr/bin/env node
/**
 * Replaces localhost api_base_url values with production panel URLs.
 * Run: node scripts/fix-panel-api-urls.js
 */
require("dotenv").config();
const mysql = require("mysql2/promise");
const {
  PRODUCTION_PANEL_API_URLS,
  isLocalApiUrl,
} = require("../src/utils/panelApiUrls");

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await pool.query(
    "SELECT id, app_name, panel_slug, api_base_url FROM applications ORDER BY id"
  );

  let updated = 0;
  for (const row of rows) {
    const slug = String(row.panel_slug || "").trim().toLowerCase();
    const current = row.api_base_url;
    const production = PRODUCTION_PANEL_API_URLS[slug];

    if (!production) continue;
    if (!current || !isLocalApiUrl(current)) continue;

    await pool.query("UPDATE applications SET api_base_url = ? WHERE id = ?", [
      production,
      row.id,
    ]);
    console.log(`✓ #${row.id} ${row.app_name}: ${current} → ${production}`);
    updated += 1;
  }

  console.log(`\n${updated} kayıt güncellendi.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
