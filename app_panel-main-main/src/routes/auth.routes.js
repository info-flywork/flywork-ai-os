const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const { pool } = require("../config/db");
const { authRequired } = require("../middlewares/auth");
const { maskEmail, sendLoginVerificationEmail, isSmtpConfigured } = require("../utils/mail");
const {
  createChallenge,
  verifyChallenge,
  refreshChallengeCode
} = require("../utils/loginVerification");

const router = express.Router();

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production"
  };
}

function issueSession(res, user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

  res.cookie("token", token, {
    ...sessionCookieOptions(),
    maxAge: 24 * 60 * 60 * 1000
  });

  return {
    message: "Giriş başarılı.",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  };
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "E-posta ve şifre zorunludur." });
  }

  if (
    env.loginEmailVerification &&
    env.nodeEnv === "production" &&
    !isSmtpConfigured()
  ) {
    return res.status(503).json({
      message: "E-posta dogrulama servisi yapilandirilmamis. SMTP ayarlarini kontrol edin."
    });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: "E-posta veya şifre hatalı." });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: "Hesabiniz pasif durumda." });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "E-posta veya şifre hatalı." });
    }

    if (!env.loginEmailVerification) {
      return res.json(issueSession(res, user));
    }

    const challenge = await createChallenge(user.id);

    try {
      const mailResult = await sendLoginVerificationEmail({
        to: user.email,
        name: user.name,
        code: challenge.code
      });

      return res.json({
        message: "Doğrulama kodu e-posta adresinize gönderildi.",
        requiresVerification: true,
        challengeId: challenge.challengeId,
        maskedEmail: maskEmail(user.email),
        expiresInSeconds: challenge.expiresInSeconds,
        devCodeLogged: Boolean(mailResult.devLogged)
      });
    } catch (mailError) {
      return res.status(503).json({
        message: "Dogrulama kodu gonderilemedi. SMTP ayarlarini kontrol edin."
      });
    }
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return res.status(503).json({
        message:
          "E-posta dogrulama tablosu bulunamadi. database/migrations/005_login_verification_challenges.sql dosyasini calistirin."
      });
    }
    return res.status(500).json({ message: "Giris sirasinda hata olustu." });
  }
});

router.post("/verify-email", async (req, res) => {
  const { challengeId, code } = req.body;

  if (!challengeId || !code) {
    return res.status(400).json({ message: "Dogrulama kodu zorunludur." });
  }

  try {
    const result = await verifyChallenge(challengeId, code);

    if (!result.ok) {
      const messages = {
        not_found: "Dogrulama oturumu bulunamadi. Lutfen tekrar giris yapin.",
        expired: "Dogrulama kodunun suresi doldu. Lutfen tekrar giris yapin.",
        too_many_attempts: "Cok fazla hatali deneme. Lutfen tekrar giris yapin.",
        inactive_user: "Hesabiniz pasif durumda.",
        invalid_code: "Dogrulama kodu hatali."
      };

      const payload = {
        message: messages[result.reason] || "Dogrulama basarisiz."
      };

      if (result.reason === "invalid_code" && result.remainingAttempts !== undefined) {
        payload.remainingAttempts = result.remainingAttempts;
      }

      const status =
        result.reason === "inactive_user"
          ? 403
          : result.reason === "invalid_code"
            ? 401
            : 400;

      return res.status(status).json(payload);
    }

    return res.json(issueSession(res, result.user));
  } catch (error) {
    return res.status(500).json({ message: "Dogrulama sirasinda hata olustu." });
  }
});

router.post("/resend-code", async (req, res) => {
  const { challengeId } = req.body;

  if (!challengeId) {
    return res.status(400).json({ message: "Dogrulama oturumu bulunamadi." });
  }

  if (env.nodeEnv === "production" && !isSmtpConfigured()) {
    return res.status(503).json({
      message: "E-posta dogrulama servisi yapilandirilmamis."
    });
  }

  try {
    const result = await refreshChallengeCode(challengeId);

    if (!result.ok) {
      if (result.reason === "cooldown") {
        return res.status(429).json({
          message: `Yeni kod icin ${result.retryAfterSeconds} saniye bekleyin.`,
          retryAfterSeconds: result.retryAfterSeconds
        });
      }

      return res.status(400).json({
        message: "Dogrulama oturumu gecersiz. Lutfen tekrar giris yapin."
      });
    }

    try {
      const mailResult = await sendLoginVerificationEmail({
        to: result.email,
        name: result.name,
        code: result.code
      });

      return res.json({
        message: "Yeni dogrulama kodu gonderildi.",
        maskedEmail: maskEmail(result.email),
        expiresInSeconds: result.expiresInSeconds,
        devCodeLogged: Boolean(mailResult.devLogged)
      });
    } catch (mailError) {
      return res.status(503).json({
        message: "Dogrulama kodu gonderilemedi."
      });
    }
  } catch (error) {
    return res.status(500).json({ message: "Kod yeniden gonderilemedi." });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", sessionCookieOptions());
  return res.json({ message: "Çıkış yapıldı." });
});

router.get("/me", authRequired, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
