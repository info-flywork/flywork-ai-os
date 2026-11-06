import nodemailer from "nodemailer";

function env(name) {
  return String(process.env[name] ?? "").trim();
}

export function smtpReport() {
  const host = env("SMTP_HOST");
  const from = env("SMTP_FROM");
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!from) missing.push("SMTP_FROM");
  return {
    connected: missing.length === 0,
    missing,
    from: from || null,
    host: host || null,
  };
}

export async function sendSmtpMail({ to, subject, text, html }) {
  const status = smtpReport();
  if (!status.connected) {
    throw new Error(`SMTP bağlı değil. Eksik: ${status.missing.join(", ")}`);
  }
  const port = Number(env("SMTP_PORT") || "587");
  const secure = env("SMTP_SECURE") === "true" || port === 465;
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const transporter = nodemailer.createTransport({
    host: status.host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
  const recipients = Array.isArray(to) ? to : [to];
  const info = await transporter.sendMail({
    from: status.from,
    to: recipients.join(", "),
    subject,
    text,
    html,
  });
  return { messageId: info.messageId, accepted: info.accepted ?? [] };
}
