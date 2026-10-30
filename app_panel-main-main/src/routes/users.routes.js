const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { authRequired, requireRoles, ROLES } = require("../middlewares/auth");

const router = express.Router();

const ASSIGNABLE_ROLES = [ROLES.ADMIN, ROLES.USER];

function mapUserRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

router.use(authRequired, requireRoles(ROLES.SUPER_ADMIN));

router.get("/", async (_, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT id, name, email, role, is_active, created_at, updated_at
      FROM users
      ORDER BY
        FIELD(role, 'SUPER_ADMIN', 'ADMIN', 'USER'),
        name ASC
      `
    );
    return res.json({ users: rows.map(mapUserRow) });
  } catch (error) {
    return res.status(500).json({ message: "Kullanici listesi alinamadi." });
  }
});

router.post("/", async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ message: "Ad, email ve sifre zorunludur." });
  }

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({ message: "Rol ADMIN veya USER olmalidir." });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ message: "Sifre en az 8 karakter olmalidir." });
  }

  const safeEmail = normalizeEmail(email);
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [name.trim(), safeEmail, passwordHash, role]
    );

    const [rows] = await pool.query(
      "SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = ? LIMIT 1",
      [result.insertId]
    );

    return res.status(201).json({
      message: "Kullanici olusturuldu.",
      user: mapUserRow(rows[0])
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Bu email zaten kayitli." });
    }
    return res.status(500).json({ message: "Kullanici olusturulamadi." });
  }
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz kullanici id." });
  }

  const { name, email, password, role, isActive } = req.body;

  try {
    const [existingRows] = await pool.query(
      "SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1",
      [id]
    );
    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ message: "Kullanici bulunamadi." });
    }

    if (existing.role === ROLES.SUPER_ADMIN && id !== req.user.id) {
      return res.status(403).json({ message: "Super Admin hesabi bu ekrandan duzenlenemez." });
    }

    const nextName = name?.trim() || existing.name;
    const nextEmail = email ? normalizeEmail(email) : existing.email;
    let nextRole = existing.role;

    if (existing.role !== ROLES.SUPER_ADMIN) {
      if (role && !ASSIGNABLE_ROLES.includes(role)) {
        return res.status(400).json({ message: "Rol ADMIN veya USER olmalidir." });
      }
      if (role) nextRole = role;
    }

    const updates = ["name = ?", "email = ?", "role = ?"];
    const values = [nextName, nextEmail, nextRole];

    if (password != null && String(password).length > 0) {
      if (String(password).length < 8) {
        return res.status(400).json({ message: "Sifre en az 8 karakter olmalidir." });
      }
      updates.push("password_hash = ?");
      values.push(await bcrypt.hash(password, 10));
    }

    if (isActive != null && existing.role !== ROLES.SUPER_ADMIN) {
      updates.push("is_active = ?");
      values.push(isActive ? 1 : 0);
    }

    values.push(id);

    await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);

    const [rows] = await pool.query(
      "SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = ? LIMIT 1",
      [id]
    );

    return res.json({
      message: "Kullanici guncellendi.",
      user: mapUserRow(rows[0])
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Bu email baska bir hesapta kullaniliyor." });
    }
    return res.status(500).json({ message: "Kullanici guncellenemedi." });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ message: "Gecersiz kullanici id." });
  }

  if (id === req.user.id) {
    return res.status(400).json({ message: "Kendi hesabinizi silemezsiniz." });
  }

  try {
    const [existingRows] = await pool.query("SELECT id, role FROM users WHERE id = ? LIMIT 1", [id]);
    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ message: "Kullanici bulunamadi." });
    }

    if (existing.role === ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: "Super Admin silinemez." });
    }

    await pool.query("DELETE FROM users WHERE id = ?", [id]);
    return res.json({ message: "Kullanici silindi." });
  } catch (error) {
    return res.status(500).json({ message: "Kullanici silinemedi." });
  }
});

module.exports = router;
