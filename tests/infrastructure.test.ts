import { afterEach, describe, expect, it } from "vitest";
import { openSessionToken, sealSessionToken } from "@/server/auth/cookieSeal";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { assertCan, can } from "@/server/auth/permissions";
import { createSessionToken, hashSessionToken } from "@/server/auth/token";
import { inclusiveDayCount } from "@/server/dates";
import { AppError, toPublicError } from "@/server/errors";
import {
  leaveRequestSchema,
  loginSchema,
  parseInput,
} from "@/server/validation/schemas";

const SECRET = "test-session-secret-value-with-32-characters";

describe("şifre ve oturum belirteci", () => {
  it("şifreyi doğrular ve aynı şifre için farklı özet üretir", async () => {
    const first = await hashPassword("Gizli123!");
    const second = await hashPassword("Gizli123!");

    expect(first).not.toBe(second);
    expect(first.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Gizli123!", first)).toBe(true);
    expect(await verifyPassword("yanlis", first)).toBe(false);
  });

  it("oturum belirtecinin özetini saklar", () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("oturum çerezini mühürler ve bozuk değeri reddeder", async () => {
    process.env.SESSION_SECRET = SECRET;
    const expiresAt = new Date(Date.now() + 60_000);
    const sealed = await sealSessionToken("ham-belirtec", expiresAt);

    expect(sealed).not.toContain("ham-belirtec");
    expect(await openSessionToken(sealed)).toBe("ham-belirtec");
    expect(await openSessionToken("bozuk")).toBeNull();
  });
});

describe("erişim kuralları", () => {
  const employeeDenied = [
    "user:read:all",
    "user:create",
    "user:update",
    "mealMenu:write",
    "mealOrder:read:all",
    "mealOrder:updateStatus",
    "leaveRequest:read:all",
    "leaveRequest:review",
    "leaveBalance:read:all",
    "leaveBalance:write",
    "expense:read:all",
    "expense:create:company",
    "expense:review",
    "invoice:read",
    "invoice:write",
    "subscription:read",
    "subscription:write",
    "automation:read",
    "automation:write",
    "dashboard:company",
  ] as const;

  it("çalışanın kendi kayıtlarını okumasına izin verir", () => {
    expect(can("EMPLOYEE", "mealOrder:create:own")).toBe(true);
    expect(can("EMPLOYEE", "leaveRequest:create:own")).toBe(true);
    expect(can("EMPLOYEE", "expense:create:own")).toBe(true);
    expect(can("EMPLOYEE", "dashboard:self")).toBe(true);
  });

  it("şirket kayıtlarını yalnızca yöneticiye açar", () => {
    for (const action of employeeDenied) {
      expect(can("EMPLOYEE", action)).toBe(false);
      expect(can("ADMIN", action)).toBe(true);
    }
  });

  it("yetkisiz işlemde sunucu hatası fırlatır", () => {
    expect(() => assertCan({ role: "EMPLOYEE" }, "invoice:write")).toThrow(
      AppError,
    );
  });

  it("çalışan izin, iş ve öneri yazar; onay yetkisi olmayan yönetici yazamaz", () => {
    expect(() => assertCan({ role: "EMPLOYEE", approver: false }, "leaveRequest:create:own")).not.toThrow();
    expect(() => assertCan({ role: "EMPLOYEE", approver: false }, "task:write")).not.toThrow();
    expect(() => assertCan({ role: "EMPLOYEE", approver: false }, "feedback:create")).not.toThrow();
    expect(() => assertCan({ role: "ADMIN", approver: false }, "leaveRequest:create:own")).toThrow(AppError);
    expect(() => assertCan({ role: "ADMIN", approver: false }, "invoice:write")).toThrow(AppError);
  });
});

describe("doğrulama ve hata mesajları", () => {
  it("geçersiz giriş ve izin aralığını reddeder", () => {
    expect(() => parseInput(loginSchema, { email: "yok", password: "" })).toThrow(
      AppError,
    );

    expect(() =>
      parseInput(leaveRequestSchema, {
        type: "ANNUAL",
        duration: "MULTI_DAY",
        startDate: "2026-10-20",
        endDate: "2026-10-18",
      }),
    ).toThrow(/Bitiş tarihi/);

    expect(inclusiveDayCount("2026-10-20", "2026-10-22")).toBe(3);
  });

  it("bilinmeyen hatalardan bağlantı bilgisini çıkarır", () => {
    const pub = toPublicError(
      new Error("connect postgresql://kullanici:gizli-sifre@localhost/flywork"),
    );

    expect(pub.message).toBe("İşlem tamamlanamadı.");
    expect(pub.message).not.toContain("gizli-sifre");
    expect(pub.status).toBe(500);
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });
});
