const nodemailer = require("nodemailer");
const env = require("../config/env");

let transporter;

function isSmtpConfigured() {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

function getTransporter() {
  if (!isSmtpConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass
      }
    });
  }

  return transporter;
}

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) {
    return email;
  }

  const visible = local.slice(0, Math.min(2, local.length));
  const hidden = local.length > 2 ? "***" : "";
  return `${visible}${hidden}@${domain}`;
}

async function sendLoginVerificationEmail({ to, name, code }) {
  const transport = getTransporter();
  const subject = "Yonetim Paneli — Giris dogrulama kodu";
  const greeting = name ? `Merhaba ${name},` : "Merhaba,";
  const text = [
    greeting,
    "",
    "Yonetim paneline giris icin dogrulama kodunuz:",
    "",
    `  ${code}`,
    "",
    "Bu kod 10 dakika gecerlidir. Kodu siz istemediyseniz bu e-postayi yok sayin.",
    "",
    env.smtp.fromName
  ].join("\n");

  const mailOptions = {
    from: `"${env.smtp.fromName}" <${env.smtp.from}>`,
    to,
    subject,
    text,
    html: `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:480px">
      <p style="margin:0 0 16px">${greeting}</p>
      <p style="margin:0 0 12px;color:#4b5563">Yonetim paneline giris icin dogrulama kodunuz:</p>
      <p style="margin:0 0 20px;font-size:28px;font-weight:700;letter-spacing:0.2em;color:#1a5c3e">${code}</p>
      <p style="margin:0;font-size:13px;color:#6b7280">Bu kod 10 dakika gecerlidir. Kodu siz istemediyseniz bu e-postayi yok sayin.</p>
    </div>
  `
  };

  if (!transport) {
    if (env.nodeEnv === "development") {
      console.log(`[mail:dev] Dogrulama kodu ${to}: ${code}`);
      return { delivered: false, devLogged: true };
    }
    throw new Error("SMTP yapilandirmasi eksik.");
  }

  await transport.sendMail(mailOptions);
  return { delivered: true, devLogged: false };
}

module.exports = {
  isSmtpConfigured,
  maskEmail,
  sendLoginVerificationEmail
};
