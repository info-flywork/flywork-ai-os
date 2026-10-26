export function redact(value) {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[gizli]")
    .replace(/(?:mysql|mariadb):\/\/\S+/gi, "mysql://[gizli]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[gizli]")
    .replace(/\bGOCSPX-[A-Za-z0-9_-]+/g, "GOCSPX-[gizli]")
    .replace(/Bearer\s+\S+/gi, "Bearer [gizli]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[gizli-oturum]")
    .replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "[gizli-telegram]");
}
