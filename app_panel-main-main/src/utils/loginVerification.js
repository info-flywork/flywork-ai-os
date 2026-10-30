const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");

const CODE_LENGTH = 6;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

async function createChallenge(userId) {
  const code = generateCode();
  const challengeId = crypto.randomUUID();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await pool.query(
    `INSERT INTO login_verification_challenges (id, user_id, code_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [challengeId, userId, codeHash, expiresAt]
  );

  await pool.query(
    `DELETE FROM login_verification_challenges
     WHERE user_id = ? AND id <> ?`,
    [userId, challengeId]
  );

  return {
    challengeId,
    code,
    expiresAt,
    expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000)
  };
}

async function getChallenge(challengeId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, c.code_hash, c.expires_at, c.attempts, c.created_at,
            u.email, u.name, u.role, u.is_active
     FROM login_verification_challenges c
     INNER JOIN users u ON u.id = c.user_id
     WHERE c.id = ?
     LIMIT 1`,
    [challengeId]
  );

  return rows[0] || null;
}

async function incrementAttempts(challengeId) {
  await pool.query(
    `UPDATE login_verification_challenges SET attempts = attempts + 1 WHERE id = ?`,
    [challengeId]
  );
}

async function deleteChallenge(challengeId) {
  await pool.query(`DELETE FROM login_verification_challenges WHERE id = ?`, [challengeId]);
}

async function verifyChallenge(challengeId, code) {
  const challenge = await getChallenge(challengeId);

  if (!challenge) {
    return { ok: false, reason: "not_found" };
  }

  if (!challenge.is_active) {
    await deleteChallenge(challengeId);
    return { ok: false, reason: "inactive_user" };
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    await deleteChallenge(challengeId);
    return { ok: false, reason: "expired" };
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    await deleteChallenge(challengeId);
    return { ok: false, reason: "too_many_attempts" };
  }

  const isValid = await bcrypt.compare(String(code).trim(), challenge.code_hash);
  if (!isValid) {
    await incrementAttempts(challengeId);
    const remaining = Math.max(0, MAX_ATTEMPTS - (challenge.attempts + 1));
    return { ok: false, reason: "invalid_code", remainingAttempts: remaining };
  }

  await deleteChallenge(challengeId);

  return {
    ok: true,
    user: {
      id: challenge.user_id,
      email: challenge.email,
      name: challenge.name,
      role: challenge.role
    }
  };
}

function canResend(challenge) {
  if (!challenge?.created_at) {
    return false;
  }
  const createdAt = new Date(challenge.created_at).getTime();
  return Date.now() - createdAt >= RESEND_COOLDOWN_MS;
}

function resendCooldownSeconds(challenge) {
  if (!challenge?.created_at) {
    return RESEND_COOLDOWN_MS / 1000;
  }
  const elapsed = Date.now() - new Date(challenge.created_at).getTime();
  return Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000));
}

async function refreshChallengeCode(challengeId) {
  const challenge = await getChallenge(challengeId);

  if (!challenge) {
    return { ok: false, reason: "not_found" };
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    await deleteChallenge(challengeId);
    return { ok: false, reason: "expired" };
  }

  if (!canResend(challenge)) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: resendCooldownSeconds(challenge)
    };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await pool.query(
    `UPDATE login_verification_challenges
     SET code_hash = ?, expires_at = ?, attempts = 0, created_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [codeHash, expiresAt, challengeId]
  );

  return {
    ok: true,
    code,
    email: challenge.email,
    name: challenge.name,
    expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000)
  };
}

module.exports = {
  CHALLENGE_TTL_MS,
  MAX_ATTEMPTS,
  createChallenge,
  getChallenge,
  verifyChallenge,
  refreshChallengeCode,
  canResend,
  resendCooldownSeconds
};
