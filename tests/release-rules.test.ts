import { describe, expect, it } from "vitest";
import { productionProblems } from "@/server/runtime/productionEnv";
import { redact } from "@/server/runtime/redact";

const ready = {
  NODE_ENV: "production",
  SESSION_SECRET: "x".repeat(32),
  DATABASE_URL: "mysql://app@127.0.0.1:3306/flywork_ai_os",
  GOOGLE_CLIENT_ID: "istemci",
  GOOGLE_CLIENT_SECRET: "gizli-deger-rapora-yazilmaz",
  GOOGLE_REDIRECT_URI: "https://panel.example.com/api/google/oauth/callback",
  AI_DOCUMENT_API_KEY: "sk-test-ornek-anahtar",
};

describe("üretim hazırlığı", () => {
  it("geliştirme ortamında üretim kontrolünü çalıştırmaz", () => {
    expect(productionProblems({ SESSION_SECRET: "kisa" }, "development")).toEqual([]);
  });

  it("eksik üretim ayarını değerini yazmadan bildirir", () => {
    const problems = productionProblems(
      {
        ...ready,
        SESSION_SECRET: "kisa",
        DATABASE_URL: "mysql://KULLANICI:SIFRE@localhost:3306/flywork_ai_os",
        GOOGLE_CLIENT_SECRET: "",
        GOOGLE_REDIRECT_URI: "http://127.0.0.1:3010/api/google/oauth/callback",
        AI_DOCUMENT_API_KEY: "",
      },
      "production",
    );
    const text = problems.join(" ");
    expect(text).toContain("SESSION_SECRET");
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain("GOOGLE_CLIENT_SECRET");
    expect(text).toContain("https");
    expect(text).toContain("AI_DOCUMENT_API_KEY");
    expect(text).not.toContain("gizli-deger-rapora-yazilmaz");
    expect(text).not.toContain("sk-test");
  });

  it("tam üretim ayarını kabul eder", () => {
    expect(productionProblems(ready, "production")).toEqual([]);
  });

  it("bağlantı ve anahtar metnini logdan siler", () => {
    const cleaned = redact(
      "hata postgresql://app:sifre@localhost:5432/flywork_ai_os ve sk-ornekanahtar123 ve Bearer abc.def ve GOCSPX-ornek",
    );
    expect(cleaned).not.toContain("sifre@");
    expect(cleaned).not.toContain("sk-ornek");
    expect(cleaned).not.toContain("abc.def");
    expect(cleaned).not.toContain("GOCSPX-ornek");
    expect(cleaned).toContain("postgresql://[gizli]");
    const token = redact("istek https://api.telegram.org/bot123456789:AAHexampletokenvalue1234567890/sendMessage");
    expect(token).not.toContain("AAHexampletokenvalue1234567890");
    expect(token).toContain("[gizli-telegram]");
  });
});
