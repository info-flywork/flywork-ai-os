// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { getPrisma } from "@/server/db";

loadEnvConfig(process.cwd());

const base = process.env.HTTP_TEST_BASE;
const databaseReady = Boolean(process.env.DATABASE_URL);
const enabled = Boolean(base && databaseReady);
const userIds: string[] = [];

function fixtureEmail() {
  return `faz3-${randomUUID()}@example.invalid`;
}

describe.skipIf(!enabled)("giriş ve rol HTTP", () => {
  const password = `Test-${randomBytes(6).toString("hex")}!a1`;
  const employeeName = `Faz3 Calisan ${randomUUID().slice(0, 8)}`;
  const otherName = `Faz3 Diger ${randomUUID().slice(0, 8)}`;
  let employeeEmail = "";
  let adminEmail = "";

  afterAll(async () => {
    if (!enabled) {
      return;
    }
    const db = getPrisma();
    if (userIds.length > 0) {
      await db.mealOrder.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await db.$disconnect();
  });

  it("giriş yapmayanı korumalı sayfadan çevirir ve roller veriyi ayırır", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(password);
    const admin = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 Yonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true },
    });
    const employee = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: employeeName,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true },
    });
    const other = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: otherName,
        role: "EMPLOYEE",
        passwordHash,
        active: false,
      },
      select: { id: true, email: true },
    });
    userIds.push(admin.id, employee.id, other.id);
    employeeEmail = employee.email;
    adminEmail = admin.email;

    const anonymous = await fetch(`${base}/`, { redirect: "manual" });
    expect(anonymous.status).toBeGreaterThanOrEqual(300);
    expect(anonymous.status).toBeLessThan(400);
    expect(anonymous.headers.get("location")).toContain("/giris");

    const loginPage = await fetch(`${base}/giris`);
    expect(loginPage.status).toBe(200);
    expect(await loginPage.text()).toContain("Giriş");

    const invalid = await fetch(`${base}/api/oturum`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "gecersiz", password: "x" }),
    });
    expect(invalid.status).toBe(400);

    const disabled = await fetch(`${base}/api/oturum`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: other.email, password }),
    });
    expect(disabled.status).toBe(401);

    async function login(email: string) {
      const response = await fetch(`${base}/api/oturum`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
      expect(cookie).toContain("flywork_session=");
      return cookie;
    }

    const health = await fetch(`${base}/api/saglik`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { ok: boolean; database: string };
    expect(healthBody).toEqual({ ok: true, database: "up" });

    const employeeCookie = await login(employeeEmail);
    const employeePage = await fetch(`${base}/yemek-yonetimi`, {
      headers: { cookie: employeeCookie },
    });
    expect(employeePage.status).toBe(200);
    const employeeHtml = await employeePage.text();
    expect(employeeHtml).toContain("Günün menüsü");
    expect(employeeHtml).not.toContain(otherName);

    const leavePage = await fetch(`${base}/izin`, {
      headers: { cookie: employeeCookie },
    });
    expect(leavePage.status).toBe(200);
    const leaveHtml = await leavePage.text();
    expect(leaveHtml).toContain("yıllık izin bakiyesi");
    expect(leaveHtml).not.toContain(otherName);

    const usersPage = await fetch(`${base}/kullanicilar`, {
      headers: { cookie: employeeCookie },
    });
    expect(usersPage.status).toBe(200);
    const usersHtml = await usersPage.text();
    expect(usersHtml).toContain("yalnızca yöneticilere açık");
    expect(usersHtml).not.toContain(other.email);
    expect(usersHtml).not.toContain(adminEmail);

    for (const path of ["/otomasyon", "/teknoloji", "/flywork-giderleri"]) {
      const restricted = await fetch(`${base}${path}`, { headers: { cookie: employeeCookie } });
      expect(restricted.status).toBe(200);
      const restrictedHtml = await restricted.text();
      expect(restrictedHtml).toMatch(/yalnızca yöneticilere/);
      expect(restrictedHtml).not.toContain(adminEmail);
    }

    const logout = await fetch(`${base}/api/oturum`, {
      method: "DELETE",
      headers: { cookie: employeeCookie },
    });
    expect(logout.status).toBe(200);
    const afterLogout = await fetch(`${base}/api/oturum`, {
      headers: { cookie: employeeCookie },
    });
    expect(afterLogout.status).toBe(401);

    const adminCookie = await login(adminEmail);
    const adminPage = await fetch(`${base}/kullanicilar`, {
      headers: { cookie: adminCookie },
    });
    expect(adminPage.status).toBe(200);
    const adminHtml = await adminPage.text();
    expect(adminHtml).toContain(employeeName);
    expect(adminHtml).toContain(employeeEmail);
  });
});
