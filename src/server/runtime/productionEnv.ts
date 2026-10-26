type Env = Record<string, string | undefined>;

export function productionProblems(env: Env, nodeEnv = env.NODE_ENV): string[] {
  if (nodeEnv !== "production") {
    return [];
  }

  const problems: string[] = [];
  if ((env.SESSION_SECRET ?? "").trim().length < 32) {
    problems.push("SESSION_SECRET üretimde en az 32 karakter olmalı.");
  }

  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl.startsWith("mysql://") && !databaseUrl.startsWith("mariadb://")) {
    problems.push("DATABASE_URL üretimde tanımlı değil.");
  } else if (databaseUrl.includes("KULLANICI") || databaseUrl.includes("SIFRE")) {
    problems.push("DATABASE_URL örnek değerle bırakılmış.");
  }

  for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const) {
    if (!(env[name] ?? "").trim()) {
      problems.push(`${name} üretimde boş.`);
    }
  }

  const redirect = (env.GOOGLE_REDIRECT_URI ?? "").trim();
  if (!redirect.startsWith("https://") || !redirect.endsWith("/api/google/oauth/callback")) {
    problems.push("GOOGLE_REDIRECT_URI üretimde https olmalı ve /api/google/oauth/callback ile bitmeli.");
  }

  if (!(env.AI_DOCUMENT_API_KEY ?? "").trim()) {
    problems.push("AI_DOCUMENT_API_KEY üretimde boş.");
  }

  return problems;
}

export function assertProductionEnv(env: Env = process.env): void {
  const problems = productionProblems(env);
  if (problems.length === 0) {
    return;
  }
  console.error(problems.join(" "));
  throw new Error("Üretim ortamı eksik.");
}
