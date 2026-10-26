// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { removeLeaveFile } from "@/server/leave/documents";
import { addIsoDays, istanbulClock } from "@/server/meals/schedule";
import {
  addLeaveHoliday,
  cancelOwnLeaveRequest,
  createLeaveRequest,
  getAdminLeaveView,
  getEmployeeLeaveView,
  openLeaveDocument,
  reverseLeaveApproval,
  reviewLeaveRequest,
  setLeaveBalance,
  updateLeaveCalendar,
} from "@/server/services/leave";
import type { Actor } from "@/server/auth/permissions";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds: string[] = [];
const holidayIds: string[] = [];

function fixtureEmail() {
  return `faz4-${randomUUID()}@example.invalid`;
}

async function expectCode(work: () => Promise<unknown>, code: string) {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Beklenen hata oluşmadı: ${code}`);
}

function mondayOnOrAfter(start: string) {
  let date = start;
  while (istanbulClock(new Date(`${date}T12:00:00+03:00`)).weekday !== 1) {
    date = addIsoDays(date, 1);
  }
  return date;
}

describe.skipIf(!databaseReady)("izin veritabanı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const leftovers = await db.user.findMany({
      where: { email: { startsWith: "faz4-", endsWith: "@example.invalid" } },
      select: { id: true },
    });
    const userIds = [...new Set([...fixtureIds, ...leftovers.map((user) => user.id)])];
    if (userIds.length > 0) {
      const documents = await db.leaveDocument.findMany({
        where: { request: { userId: { in: userIds } } },
        select: { storageKey: true },
      });
      for (const document of documents) {
        await removeLeaveFile(document.storageKey);
      }
      await db.leaveRequest.deleteMany({ where: { userId: { in: userIds } } });
      await db.leaveBalance.deleteMany({ where: { userId: { in: userIds } } });
      await db.leaveAudit.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (holidayIds.length > 0) {
      await db.leaveHoliday.deleteMany({ where: { id: { in: holidayIds } } });
    }
    await db.leaveSettings.upsert({
      where: { id: "default" },
      update: { hoursPerDay: "8.00", weekendDays: [] },
      create: { id: "default", hoursPerDay: "8.00", weekendDays: [] },
    });
    await db.$disconnect();
  });

  it("onay, ret, iptal, saatlik süre ve çakışmayı bakiyeyle birlikte tutar", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 Yonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 Calisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const otherRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 Diger ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id, otherRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const other: Actor = otherRow;
    const monday = mondayOnOrAfter("2098-03-02");

    await setLeaveBalance(admin, {
      userId: employee.id,
      year: 2098,
      allocatedDays: "1.00",
      allowBelowUsed: false,
    });

    const first = await createLeaveRequest(employee, {
      type: "ANNUAL",
      duration: "FULL_DAY",
      startDate: monday,
      endDate: monday,
    });
    const second = await createLeaveRequest(employee, {
      type: "ANNUAL",
      duration: "FULL_DAY",
      startDate: addIsoDays(monday, 1),
      endDate: addIsoDays(monday, 1),
    });
    const settled = await Promise.allSettled([
      reviewLeaveRequest(admin, first.id, { decision: "APPROVED", balanceException: false }),
      reviewLeaveRequest(admin, second.id, { decision: "APPROVED", balanceException: false }),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1);
    const approvedDate = settled[0].status === "fulfilled" ? monday : addIsoDays(monday, 1);
    const approvedRequestId = settled[0].status === "fulfilled" ? first.id : second.id;
    const balanceAfterRace = await db.leaveBalance.findUnique({
      where: { userId_year_type: { userId: employee.id, year: 2098, type: "ANNUAL" } },
    });
    expect(balanceAfterRace?.usedDays.toFixed(2)).toBe("1.00");

    const duplicate = await createLeaveRequest(employee, {
      type: "SICK",
      duration: "FULL_DAY",
      startDate: addIsoDays(monday, 2),
      endDate: addIsoDays(monday, 2),
    });
    const duplicateReview = await Promise.allSettled([
      reviewLeaveRequest(admin, duplicate.id, { decision: "APPROVED", balanceException: false }),
      reviewLeaveRequest(admin, duplicate.id, { decision: "APPROVED", balanceException: false }),
    ]);
    expect(duplicateReview.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    await expectCode(
      () => reviewLeaveRequest(admin, duplicate.id, { decision: "APPROVED", balanceException: false }),
      "CONFLICT",
    );
    expect(balanceAfterRace && (await db.leaveBalance.findUnique({
      where: { userId_year_type: { userId: employee.id, year: 2098, type: "ANNUAL" } },
    }))?.usedDays.toFixed(2)).toBe("1.00");

    await expectCode(
      () =>
        createLeaveRequest(employee, {
          type: "EXCUSE",
          duration: "FULL_DAY",
          startDate: approvedDate,
          endDate: approvedDate,
        }),
      "CONFLICT",
    );

    const rejected = await createLeaveRequest(employee, {
      type: "ANNUAL",
      duration: "FULL_DAY",
      startDate: addIsoDays(monday, 3),
      endDate: addIsoDays(monday, 3),
    });
    await reviewLeaveRequest(admin, rejected.id, {
      decision: "REJECTED",
      reviewNote: "Ekip planı uygun değil",
      balanceException: false,
    });
    expect((await db.leaveBalance.findUnique({
      where: { userId_year_type: { userId: employee.id, year: 2098, type: "ANNUAL" } },
    }))?.usedDays.toFixed(2)).toBe("1.00");

    const pending = await createLeaveRequest(employee, {
      type: "ANNUAL",
      duration: "HOURLY",
      startDate: addIsoDays(monday, 4),
      endDate: addIsoDays(monday, 4),
      startTime: "09:00",
      endTime: "13:00",
    });
    await cancelOwnLeaveRequest(employee, pending.id);
    const cancelled = await db.leaveRequest.findUnique({ where: { id: pending.id } });
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.dayCount.toFixed(2)).toBe("0.50");

    const blocked = await createLeaveRequest(employee, {
      type: "ANNUAL",
      duration: "FULL_DAY",
      startDate: addIsoDays(monday, 8),
      endDate: addIsoDays(monday, 8),
    });
    await expectCode(
      () => reviewLeaveRequest(admin, blocked.id, { decision: "APPROVED", balanceException: false }),
      "CONFLICT",
    );
    await reviewLeaveRequest(admin, blocked.id, { decision: "APPROVED", balanceException: true });
    expect((await db.leaveBalance.findUnique({
      where: { userId_year_type: { userId: employee.id, year: 2098, type: "ANNUAL" } },
    }))?.usedDays.toFixed(2)).toBe("2.00");

    const withFile = await createLeaveRequest(
      employee,
      {
        type: "SICK",
        duration: "FULL_DAY",
        startDate: addIsoDays(monday, 9),
        endDate: addIsoDays(monday, 9),
      },
      {
        bytes: Buffer.from("%PDF-1.4\nfaz4"),
        fileName: "rapor.pdf",
        contentType: "application/pdf",
      },
    );
    const stored = await db.leaveDocument.findUnique({ where: { requestId: withFile.id } });
    const opened = await openLeaveDocument(employee, stored!.id);
    expect(opened.contentType).toBe("application/pdf");
    await expectCode(() => openLeaveDocument(other, stored!.id), "NOT_FOUND");
    await expectCode(
      () =>
        createLeaveRequest(
          employee,
          {
            type: "SICK",
            duration: "FULL_DAY",
            startDate: addIsoDays(monday, 10),
            endDate: addIsoDays(monday, 10),
          },
          { bytes: Buffer.from("merhaba"), fileName: "not.txt", contentType: "text/plain" },
        ),
      "VALIDATION",
    );

    const ownView = await getEmployeeLeaveView(employee);
    expect(JSON.stringify(ownView)).not.toContain(other.name);
    await expectCode(
      () => reviewLeaveRequest(employee, blocked.id, { decision: "REJECTED", reviewNote: "yok", balanceException: false }),
      "FORBIDDEN",
    );

    const audits = await db.leaveAudit.findMany({
      where: { requestId: blocked.id },
      select: { action: true, actorId: true },
    });
    expect(audits.map((audit) => audit.action)).toContain("APPROVED");
    expect(audits.map((audit) => audit.action)).toContain("BALANCE_DEDUCTED");
    expect(audits.every((audit) => audit.actorId === admin.id || audit.action === "REQUESTED")).toBe(true);

    await reverseLeaveApproval(admin, approvedRequestId, "Plan değişti");
    expect((await db.leaveBalance.findUnique({
      where: { userId_year_type: { userId: employee.id, year: 2098, type: "ANNUAL" } },
    }))?.usedDays.toFixed(2)).toBe("1.00");

    const month = await getAdminLeaveView(admin, {
      employeeId: employee.id,
      report: "month",
      period: "2098-03",
    });
    const year = await getAdminLeaveView(admin, {
      employeeId: employee.id,
      report: "year",
      period: "2098",
    });
    expect(month.period).toEqual({ from: "2098-03-01", to: "2098-03-31" });
    expect(year.period).toEqual({ from: "2098-01-01", to: "2098-12-31" });
    expect(month.report.total).toBeGreaterThan(0);
    expect(Number(month.report.approvedDays)).toBeGreaterThan(0);
    expect(year.report.approvedDays).toBe(month.report.approvedDays);
    expect(year.year).toBe(2098);
    expect(year.roster.find((row) => row.name === employee.name)?.excuseDays).toBe("0.00");
    expect(month.requests.every((row) => row.employeeName === employee.name)).toBe(true);
    expect(month.report.byEmployee.some((row) => row.name === other.name)).toBe(false);
    const sickDate = addIsoDays(monday, 2);
    const day = await getAdminLeaveView(admin, {
      employeeId: employee.id,
      report: "day",
      period: sickDate,
    });
    const week = await getAdminLeaveView(admin, {
      employeeId: employee.id,
      report: "week",
      period: sickDate,
    });
    expect(day.period).toEqual({ from: sickDate, to: sickDate });
    expect(day.report.away).toBeGreaterThan(0);
    expect(Number(day.report.approvedDays)).toBeGreaterThan(0);
    expect(day.report.byEmployee.some((row) => row.name === employee.name)).toBe(true);
    expect(week.period.from <= approvedDate && week.period.to >= approvedDate).toBe(true);
    expect(Number(week.report.approvedDays)).toBeGreaterThanOrEqual(Number(day.report.approvedDays));
    await expectCode(
      () =>
        getAdminLeaveView(employee, {
          report: "month",
          period: "2098-03",
        }),
      "FORBIDDEN",
    );

    const auditActions = (
      await db.leaveAudit.findMany({
        where: { userId: employee.id },
        select: { action: true },
      })
    ).map((audit) => audit.action);
    for (const action of [
      "REQUESTED",
      "APPROVED",
      "REJECTED",
      "CANCELLED",
      "REVERSED",
      "BALANCE_SET",
      "BALANCE_DEDUCTED",
      "BALANCE_RESTORED",
    ]) {
      expect(auditActions).toContain(action);
    }
  });

  it("tanımlı hafta sonunu çok günlü izinden düşer", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 Takvim ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 Gun ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const monday = mondayOnOrAfter("2097-09-01");
    await updateLeaveCalendar(admin, { hoursPerDay: "8", weekendDays: [6, 7] });
    const holiday = await addLeaveHoliday(admin, { date: addIsoDays(monday, 2), name: "Faz4 Tatil" });
    holidayIds.push(holiday.id);

    const request = await createLeaveRequest(employee, {
      type: "EXCUSE",
      duration: "MULTI_DAY",
      startDate: monday,
      endDate: addIsoDays(monday, 6),
    });
    const row = await db.leaveRequest.findUnique({ where: { id: request.id } });
    expect(row?.dayCount.toFixed(2)).toBe("4.00");
  });
});
