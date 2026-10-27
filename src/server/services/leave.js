import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";

import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { assertCan } from "@/server/auth/permissions";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { annualAllocationForYear } from "@/server/leave/entitlement";
import { withDatabase } from "@/server/db";
import { invalidate, remember } from "@/server/readCache";
import { numberList } from "@/server/jsonList";
import { notifyLeaveDecision, notifyLeaveRequested } from "@/server/telegram/leavePush";
import { AppError } from "@/server/errors";
import {
  inspectLeaveFile,
  readLeaveFile,
  removeLeaveFile,
  writeLeaveFile,
} from "@/server/leave/documents";
import {
  computeLeave,
  formatIstanbulDateTime,
  formatIstanbulTime,
  LeaveCalcError,

} from "@/server/leave/duration";
import { reportRange, WEEKDAY_LABELS } from "@/server/meals/schedule";
import {
  leaveBalanceSchema,
  leaveCalendarSchema,
  leaveHolidaySchema,
  leaveRequestSchema,
  leaveReviewSchema,
  parseInput,
} from "@/server/validation/schemas";

const SETTINGS_ID = "default";

 







async function lockEmployee(db, userId) {
  const name = `leave:${userId}`.slice(0, 64);
  const rows = await db.$queryRaw`SELECT GET_LOCK(${name}, 15) AS locked`;
  if (Number(rows[0]?.locked) !== 1) {
    throw new AppError("Bu personelin kaydı şu an işlemde.", "CONFLICT", 409);
  }
  return async () => {
    await db.$queryRaw`SELECT RELEASE_LOCK(${name})`;
  };
}

async function approvedBalanceCharge(db, userId, year) {
  const total = await db.leaveRequest.aggregate({
    where: {
      userId,
      status: "APPROVED",
      settlement: { not: "SALARY" },
      type: { in: ["ANNUAL", "UNPAID"] },
      startDate: { gte: dateOnly(`${year}-01-01`), lte: dateOnly(`${year}-12-31`) },
    },
    _sum: { dayCount: true },
  });
  return total._sum.dayCount ?? new Prisma.Decimal(0);
}

async function ensureAnnualBalances(db, people, fromYear, toYear, today = istanbulToday(), known) {
  const years = [];
  for (let year = fromYear; year <= toYear && year - fromYear < 20; year += 1) {
    years.push(year);
  }
  if (years.length === 0 || people.length === 0) {
    return 0;
  }
  const existing = known ?? await db.leaveBalance.findMany({
    where: { type: "ANNUAL", year: { in: years }, userId: { in: people.map((person) => person.id) } },
  });
  const byKey = new Map(existing.map((row) => [`${row.userId}:${row.year}`, row]));
  const writes = [];
  for (const year of years) {
    for (const person of people) {
      const startedOn = person.startedOn ? toIsoDate(person.startedOn) : null;
      const allocated = annualAllocationForYear(startedOn, year, today);
      if (!allocated) {
        continue;
      }
      const row = byKey.get(`${person.id}:${year}`);
      if (row) {
        if (row.allocatedDays.toFixed(2) !== allocated) {
          writes.push(db.leaveBalance.update({ where: { id: row.id }, data: { allocatedDays: allocated } }));
        }
        continue;
      }
      writes.push((async () => {
        const usedDays = await approvedBalanceCharge(db, person.id, year);
        await db.leaveBalance.upsert({
          where: { userId_year_type: { userId: person.id, year, type: "ANNUAL" } },
          create: { userId: person.id, year, type: "ANNUAL", allocatedDays: allocated, usedDays },
          update: { allocatedDays: allocated },
        });
      })());
    }
  }
  await Promise.all(writes);
  return writes.length;
}

async function ensureAnnualBalance(db, userId, year, today = istanbulToday()) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { startedOn: true },
  });
  const allocated = annualAllocationForYear(user?.startedOn ? toIsoDate(user.startedOn) : null, year, today);
  if (!allocated) {
    return null;
  }
  const existing = await db.leaveBalance.findUnique({
    where: { userId_year_type: { userId, year, type: "ANNUAL" } },
  });
  if (existing) {
    if (existing.allocatedDays.toFixed(2) === allocated) {
      return existing;
    }
    return db.leaveBalance.update({
      where: { id: existing.id },
      data: { allocatedDays: allocated },
    });
  }
  const usedDays = await approvedBalanceCharge(db, userId, year);
  return db.leaveBalance.upsert({
    where: { userId_year_type: { userId, year, type: "ANNUAL" } },
    create: { userId, year, type: "ANNUAL", allocatedDays: allocated, usedDays },
    update: { allocatedDays: allocated },
  });
}

function readSettings(row) {
  if (!row) {
    return { hoursPerDay: new Prisma.Decimal("9.00"), weekendDays: [] };
  }
  return { ...row, weekendDays: numberList(row.weekendDays) };
}

async function ensureSettings(db) {
  const settings = await db.leaveSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: {
      id: SETTINGS_ID,
      hoursPerDay: "9.00",
      weekendDays: [],
    },
  });
  return { ...settings, weekendDays: numberList(settings.weekendDays) };
}

async function loadCalendar(db) {
  const settings = await ensureSettings(db);
  const holidays = await db.leaveHoliday.findMany({
    where: { active: true },
    select: { date: true },
  });
  return {
    hoursPerDay: Number(settings.hoursPerDay),
    weekendDays: settings.weekendDays,
    holidays: holidays.map((holiday) => toIsoDate(holiday.date)),
  };
}

function calculated(input, calendar) {
  const data = parseInput(leaveRequestSchema, input);
  try {
    return { data, span: computeLeave(data, calendar) };
  } catch (error) {
    if (error instanceof LeaveCalcError) {
      throw new AppError(error.message, "VALIDATION", 400);
    }
    throw error;
  }
}

function sqlBool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return Number(value) !== 0;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value.length > 0 && value[0] !== 0;
  }
  return value === "1" || value === "true";
}

function sqlDate(value) {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

async function loadJoinedLeaveRequests(db, filter = {}) {
  const take = Math.min(Math.max(Number(filter.take) || 400, 1), 400);
  const parts = [];
  if (filter.userId) {
    parts.push(Prisma.sql`userId = ${filter.userId}`);
  }
  if (filter.type) {
    parts.push(Prisma.sql`type = ${filter.type}`);
  }
  if (filter.to) {
    parts.push(Prisma.sql`startDate <= ${dateOnly(filter.to)}`);
  }
  if (filter.from) {
    parts.push(Prisma.sql`endDate >= ${dateOnly(filter.from)}`);
  }
  const where = parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`1=1`;
  const rows = await db.$queryRaw`
    SELECT
      r.id AS requestId,
      r.userId AS userId,
      r.type AS type,
      r.duration AS duration,
      DATE_FORMAT(r.startDate, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(r.endDate, '%Y-%m-%d') AS endDate,
      r.startsAt AS startsAt,
      r.endsAt AS endsAt,
      r.dayCount AS dayCount,
      r.hourCount AS hourCount,
      r.reason AS reason,
      r.status AS status,
      r.settlement AS settlement,
      r.reviewNote AS reviewNote,
      r.balanceException AS balanceException,
      r.reviewedAt AS reviewedAt,
      r.createdAt AS createdAt,
      u.name AS employeeName,
      reviewer.name AS reviewerName,
      doc.id AS documentId,
      doc.fileName AS fileName,
      doc.sizeBytes AS sizeBytes,
      a.id AS auditId,
      a.action AS auditAction,
      a.note AS auditNote,
      a.dayDelta AS dayDelta,
      a.createdAt AS auditAt,
      actor.name AS actorName
    FROM (
      SELECT * FROM \`LeaveRequest\`
      WHERE ${where}
      ORDER BY createdAt DESC
      LIMIT ${Prisma.raw(String(take))}
    ) r
    JOIN \`User\` u ON u.id = r.userId
    LEFT JOIN \`User\` reviewer ON reviewer.id = r.reviewerId
    LEFT JOIN \`LeaveDocument\` doc ON doc.requestId = r.id
    LEFT JOIN \`LeaveAudit\` a ON a.requestId = r.id
    LEFT JOIN \`User\` actor ON actor.id = a.actorId
    ORDER BY r.createdAt DESC, a.createdAt DESC
  `;
  const grouped = new Map();
  for (const row of rows) {
    let request = grouped.get(row.requestId);
    if (!request) {
      request = {
        id: row.requestId,
        user: { id: row.userId, name: row.employeeName },
        type: row.type,
        duration: row.duration,
        startDate: dateOnly(String(row.startDate).slice(0, 10)),
        endDate: dateOnly(String(row.endDate).slice(0, 10)),
        startsAt: sqlDate(row.startsAt),
        endsAt: sqlDate(row.endsAt),
        dayCount: new Prisma.Decimal(String(row.dayCount)),
        hourCount: row.hourCount == null ? null : new Prisma.Decimal(String(row.hourCount)),
        reason: row.reason,
        status: row.status,
        settlement: row.settlement,
        reviewNote: row.reviewNote,
        balanceException: sqlBool(row.balanceException),
        reviewedAt: row.reviewedAt ? sqlDate(row.reviewedAt) : null,
        reviewer: row.reviewerName ? { name: row.reviewerName } : null,
        createdAt: sqlDate(row.createdAt),
        document: row.documentId
          ? { id: row.documentId, fileName: row.fileName, sizeBytes: Number(row.sizeBytes) }
          : null,
        audits: [],
      };
      grouped.set(row.requestId, request);
    }
    if (row.auditId && request.audits.length < 8) {
      request.audits.push({
        id: row.auditId,
        action: row.auditAction,
        note: row.auditNote,
        dayDelta: row.dayDelta == null ? null : new Prisma.Decimal(String(row.dayDelta)),
        createdAt: sqlDate(row.auditAt),
        actor: { name: row.actorName ?? "" },
      });
    }
  }
  return [...grouped.values()];
}

function serializeRequest(request



























) {
  return {
    id: request.id,
    employeeId: request.user.id,
    employeeName: request.user.name,
    type: request.type,
    duration: request.duration,
    startDate: toIsoDate(request.startDate),
    endDate: toIsoDate(request.endDate),
    startTime: request.duration === "HOURLY" ? formatIstanbulTime(request.startsAt) : null,
    endTime: request.duration === "HOURLY" ? formatIstanbulTime(request.endsAt) : null,
    dayCount: request.dayCount.toFixed(2),
    hourCount: request.hourCount?.toFixed(2) ?? null,
    reason: request.reason,
    status: request.status,
    settlement: request.settlement,
    reviewNote: request.reviewNote,
    balanceException: request.balanceException,
    reviewedAt: request.reviewedAt ? formatIstanbulDateTime(request.reviewedAt) : null,
    reviewerName: request.reviewer?.name ?? null,
    createdAt: formatIstanbulDateTime(request.createdAt),
    document: request.document,
    audits: request.audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      note: audit.note,
      dayDelta: audit.dayDelta?.toFixed(2) ?? null,
      at: formatIstanbulDateTime(audit.createdAt),
      actorName: audit.actor.name,
    })),
  };
}

function serializeCalendar(settings, holidays) {
  return {
    hoursPerDay: settings.hoursPerDay.toFixed(2),
    weekendDays: settings.weekendDays,
    weekendLabels: settings.weekendDays.map((day) => WEEKDAY_LABELS[day]).filter(Boolean),
    holidays: holidays.map((holiday) => ({
      id: holiday.id,
      date: toIsoDate(holiday.date),
      name: holiday.name,
      active: holiday.active,
    })),
  };
}

export async function getEmployeeLeaveView(actor) {
  assertNotMealOnly(actor);
  assertCan(actor, "leaveRequest:read:own");
  const year = Number(istanbulToday().slice(0, 4));

  return remember(`leave:own:${actor.id}:${year}`, () => withDatabase(async (db) => {
    const [settings, holidays, person, balance, requests] = await Promise.all([
      db.leaveSettings.findUnique({ where: { id: SETTINGS_ID } }).then(readSettings),
      db.leaveHoliday.findMany({ orderBy: { date: "asc" } }),
      db.user.findUnique({ where: { id: actor.id }, select: { startedOn: true } }),
      db.leaveBalance.findUnique({
        where: { userId_year_type: { userId: actor.id, year, type: "ANNUAL" } },
      }),
      loadJoinedLeaveRequests(db, { userId: actor.id }),
    ]);
    const allocated = annualAllocationForYear(
      person?.startedOn ? toIsoDate(person.startedOn) : null,
      year,
      istanbulToday(),
    );
    let current = balance;
    if (allocated && (!current || current.allocatedDays.toFixed(2) !== allocated)) {
      const usedDays = current ? current.usedDays : await approvedBalanceCharge(db, actor.id, year);
      current = await db.leaveBalance.upsert({
        where: { userId_year_type: { userId: actor.id, year, type: "ANNUAL" } },
        create: { userId: actor.id, year, type: "ANNUAL", allocatedDays: allocated, usedDays },
        update: { allocatedDays: allocated },
      });
    }
    const counted = requests.filter((request) => {
      const starts = toIsoDate(request.startDate);
      return request.status === "APPROVED" && request.settlement !== "SALARY" && starts >= "2025-01-01" && starts <= `${year}-12-31`;
    });
    const used = counted.reduce((sum, request) => sum.plus(request.dayCount), new Prisma.Decimal(0));
    const excuse = counted
      .filter((request) => request.type === "EXCUSE")
      .reduce((sum, request) => sum.plus(request.dayCount), new Prisma.Decimal(0));
    const againstAnnual = used.minus(excuse);
    if (current && new Prisma.Decimal(current.usedDays).lessThan(againstAnnual)) {
      void db.leaveBalance.update({
        where: { id: current.id },
        data: { usedDays: againstAnnual },
      }).catch(() => undefined);
    }

    return {
      year,
      balance: current
        ? {
            allocatedDays: current.allocatedDays.toFixed(2),
            usedDays: againstAnnual.toFixed(2),
            remainingDays: new Prisma.Decimal(current.allocatedDays).minus(againstAnnual).toFixed(2),
          }
        : null,
      calendar: serializeCalendar(settings, holidays.filter((holiday) => holiday.active)),
      requests: requests.map(serializeRequest),
    };
  }));
}

 








export async function getAdminLeaveView(actor, filters) {
  assertCan(actor, "leaveRequest:read:all");
  const period = reportWindow(filters.report, filters.period);

  return remember(`leave:admin:${actor.id}:${JSON.stringify(filters)}`, () => withDatabase(async (db) => {
    const spanFrom = filters.from ?? period.from;
    const spanTo = filters.to ?? period.to;
    const firstYear = Number(spanFrom.slice(0, 4));
    const lastYear = Number(spanTo.slice(0, 4));
    const today = istanbulToday();
    const reportFilter = [
      Prisma.sql`r.startDate <= ${dateOnly(period.to)}`,
      Prisma.sql`r.endDate >= ${dateOnly(period.from)}`,
    ];
    if (filters.employeeId) {
      reportFilter.push(Prisma.sql`r.userId = ${filters.employeeId}`);
    }
    if (filters.type) {
      reportFilter.push(Prisma.sql`r.type = ${filters.type}`);
    }
    const [settings, holidays, people, requests, reportRows, usage, balances] = await Promise.all([
      db.leaveSettings.findUnique({ where: { id: SETTINGS_ID } }).then(readSettings),
      db.leaveHoliday.findMany({ orderBy: { date: "asc" } }),
      db.user.findMany({
        where: {
          active: true,
          mealOnly: false,
          NOT: { role: "ADMIN", approver: false },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, active: true, startedOn: true },
      }),
      loadJoinedLeaveRequests(db, {
        userId: filters.employeeId,
        type: filters.type,
        from: filters.from,
        to: filters.to,
        take: 200,
      }),
      db.$queryRaw`
        SELECT r.type AS type, r.status AS status, r.dayCount AS dayCount, u.name AS employeeName
        FROM \`LeaveRequest\` r
        JOIN \`User\` u ON u.id = r.userId
        WHERE ${Prisma.join(reportFilter, " AND ")}
      `.then((rows) => rows.map((row) => ({
        type: row.type,
        status: row.status,
        dayCount: new Prisma.Decimal(String(row.dayCount)),
        user: { name: row.employeeName },
      }))),
      db.$queryRaw`
        SELECT userId AS userId, type AS type, dayCount AS dayCount
        FROM \`LeaveRequest\`
        WHERE status = 'APPROVED'
          AND settlement <> 'SALARY'
          AND startDate >= ${dateOnly(spanFrom)}
          AND startDate <= ${dateOnly(spanTo)}
      `.then((rows) => rows.map((row) => ({
        userId: row.userId,
        type: row.type,
        dayCount: new Prisma.Decimal(String(row.dayCount)),
      }))),
      db.$queryRaw`
        SELECT
          b.id AS id,
          b.year AS year,
          b.allocatedDays AS allocatedDays,
          b.usedDays AS usedDays,
          u.id AS userId,
          u.name AS employeeName
        FROM \`LeaveBalance\` b
        JOIN \`User\` u ON u.id = b.userId
        WHERE b.type = 'ANNUAL' AND b.year >= ${firstYear} AND b.year <= ${lastYear}
        ORDER BY b.year ASC, u.name ASC
      `.then((rows) => rows.map((row) => ({
        id: row.id,
        year: Number(row.year),
        allocatedDays: new Prisma.Decimal(String(row.allocatedDays)),
        usedDays: new Prisma.Decimal(String(row.usedDays)),
        user: { id: row.userId, name: row.employeeName },
      }))),
    ]);
    const employees = people.map((person) => ({
      id: person.id,
      name: person.name,
      active: person.active,
      startedOn: person.startedOn ? toIsoDate(person.startedOn) : null,
    }));

    const byType = new Map();
    const byEmployee = new Map();
    let approvedDays = new Prisma.Decimal(0);
    let away = 0;
    for (const row of reportRows) {
      const typeRow = byType.get(row.type) ?? { count: 0, approved: new Prisma.Decimal(0) };
      typeRow.count += 1;
      const employeeRow = byEmployee.get(row.user.name) ?? {
        count: 0,
        approved: new Prisma.Decimal(0),
      };
      employeeRow.count += 1;
      if (row.status === "APPROVED") {
        typeRow.approved = typeRow.approved.plus(row.dayCount);
        employeeRow.approved = employeeRow.approved.plus(row.dayCount);
        approvedDays = approvedDays.plus(row.dayCount);
        away += 1;
      }
      byType.set(row.type, typeRow);
      byEmployee.set(row.user.name, employeeRow);
    }

    const year = Number(period.from.slice(0, 4));
    const wrote = await ensureAnnualBalances(
      db,
      people,
      firstYear,
      lastYear,
      today,
      balances.map((row) => ({
        id: row.id,
        userId: row.user.id,
        year: row.year,
        allocatedDays: row.allocatedDays,
      })),
    );
    const settledBalances = wrote
      ? await db.leaveBalance.findMany({
          where: { type: "ANNUAL", year: { gte: firstYear, lte: lastYear } },
          orderBy: [{ year: "asc" }, { user: { name: "asc" } }],
          select: {
            id: true,
            year: true,
            allocatedDays: true,
            usedDays: true,
            user: { select: { id: true, name: true } },
          },
        })
      : balances;
    const daysByUser = new Map();
    for (const row of usage) {
      const current = daysByUser.get(row.userId) ?? {
        used: new Prisma.Decimal(0),
        excuse: new Prisma.Decimal(0),
      };
      current.used = current.used.plus(row.dayCount);
      if (row.type === "EXCUSE") {
        current.excuse = current.excuse.plus(row.dayCount);
      }
      daysByUser.set(row.userId, current);
    }

    const balanceByUser = new Map();
    for (const balance of settledBalances) {
      const current = balanceByUser.get(balance.user.id) ?? {
        allocated: new Prisma.Decimal(0),
        rows: [],
      };
      current.allocated = current.allocated.plus(balance.allocatedDays);
      current.rows.push(balance);
      balanceByUser.set(balance.user.id, current);
    }
    const repairs = [];
    for (const [userId, balance] of balanceByUser) {
      const days = daysByUser.get(userId);
      const againstAnnual = (days?.used ?? new Prisma.Decimal(0)).minus(days?.excuse ?? new Prisma.Decimal(0));
      if (balance.rows.length === 1 && new Prisma.Decimal(balance.rows[0].usedDays).lessThan(againstAnnual)) {
        balance.rows[0].usedDays = againstAnnual;
        repairs.push(db.leaveBalance.update({
          where: { id: balance.rows[0].id },
          data: { usedDays: againstAnnual },
        }));
      }
    }
    if (repairs.length) {
      void Promise.all(repairs).catch(() => undefined);
    }
    const cardOrder = ["emrah doğan", "sena özyiğit", "furkan kazım çam", "tunahan avşar"];
    const roster = employees
      .map((employee) => {
        const days = daysByUser.get(employee.id);
        const balance = balanceByUser.get(employee.id);
        return {
          id: employee.id,
          name: employee.name,
          active: employee.active,
          startedOn: employee.startedOn,
          usedDays: (days?.used ?? new Prisma.Decimal(0)).toFixed(2),
          excuseDays: (days?.excuse ?? new Prisma.Decimal(0)).toFixed(2),
          remainingDays: balance
            ? balance.allocated.minus((days?.used ?? new Prisma.Decimal(0)).minus(days?.excuse ?? new Prisma.Decimal(0))).toFixed(2)
            : null,
        };
      })
      .sort((left, right) => {
        const leftRank = cardOrder.indexOf(left.name.toLocaleLowerCase("tr"));
        const rightRank = cardOrder.indexOf(right.name.toLocaleLowerCase("tr"));
        const leftOrder = leftRank === -1 ? cardOrder.length : leftRank;
        const rightOrder = rightRank === -1 ? cardOrder.length : rightRank;
        return leftOrder - rightOrder || left.name.localeCompare(right.name, "tr");
      });

    return {
      filters,
      period,
      year,
      roster,
      employees,
      calendar: serializeCalendar(settings, holidays),
      balances: settledBalances.map((balance) => ({
        id: balance.id,
        userId: balance.user.id,
        employeeName: balance.user.name,
        year: balance.year,
        allocatedDays: balance.allocatedDays.toFixed(2),
        usedDays: balance.usedDays.toFixed(2),
        remainingDays: new Prisma.Decimal(balance.allocatedDays).minus(balance.usedDays).toFixed(2),
      })),
      requests: requests.map(serializeRequest),
      report: {
        mode: filters.report,
        from: period.from,
        to: period.to,
        total: reportRows.length,
        away,
        approvedDays: approvedDays.toFixed(2),
        byType: [...byType.entries()].map(([type, row]) => ({
          type,
          count: row.count,
          approvedDays: row.approved.toFixed(2),
        })),
        byEmployee: [...byEmployee.entries()]
          .map(([name, row]) => ({
            name,
            count: row.count,
            approvedDays: row.approved.toFixed(2),
          }))
          .sort((left, right) => left.name.localeCompare(right.name, "tr")),
      },
    };
  }));
}

export async function createLeaveRequest(actor, input, file) {
  invalidate("leave");
  assertNotMealOnly(actor);
  assertCan(actor, "leaveRequest:create:own");
  const attachment = file && file.bytes.length > 0 ? inspectLeaveFile(file) : null;

  const created = await withDatabase((db) =>
    db.$transaction(async (tx) => {
      const unlockEmployee = await lockEmployee(tx, actor.id);
      try {
      const calendar = await loadCalendar(tx);
      const { data, span } = calculated(input, calendar);
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          userId: actor.id,
          status: "APPROVED",
          startsAt: { lt: span.endsAt },
          endsAt: { gt: span.startsAt },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new AppError("Bu aralık onaylı bir izninizle çakışıyor.", "CONFLICT", 409);
      }

      const request = await tx.leaveRequest.create({
        data: {
          userId: actor.id,
          type: data.type,
          duration: data.duration,
          startDate: dateOnly(span.startDate),
          endDate: dateOnly(span.endDate),
          startsAt: span.startsAt,
          endsAt: span.endsAt,
          dayCount: span.dayCount,
          hourCount: span.hourCount,
          reason: data.reason,
        },
      });
      await tx.leaveAudit.create({
        data: {
          requestId: request.id,
          userId: actor.id,
          actorId: actor.id,
          action: "REQUESTED",
          dayDelta: span.dayCount,
          note: data.reason,
        },
      });
      return request;
      } finally {
        await unlockEmployee();
      }
    }),
  );

  if (attachment) {

  const storageKey = randomBytes(16).toString("hex");
  try {
    await writeLeaveFile(storageKey, attachment.bytes);
    await withDatabase((db) =>
      db.leaveDocument.create({
        data: {
          requestId: created.id,
          storageKey,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.bytes.length,
        },
      }),
    );
  } catch (error) {
    await removeLeaveFile(storageKey);
    await withDatabase((db) => db.leaveRequest.delete({ where: { id: created.id } }));
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Belge kaydedilemedi.", "INTERNAL", 500);
  }
  }

  const adminNotified = await notifyLeaveRequested(created.id);
  return { id: created.id, adminNotified };
}

export async function cancelOwnLeaveRequest(actor, requestId) {
  invalidate("leave");
  assertNotMealOnly(actor);
  assertCan(actor, "leaveRequest:create:own");

  return withDatabase((db) =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`LeaveRequest\` WHERE \`id\` = ${requestId} FOR UPDATE`;
      const current = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!current || current.userId !== actor.id) {
        throw new AppError("İzin talebi bulunamadı.", "NOT_FOUND", 404);
      }
      if (current.status !== "PENDING") {
        throw new AppError("Yalnızca henüz değerlendirilmemiş talep iptal edilebilir.", "CONFLICT", 409);
      }

      await tx.leaveRequest.update({
        where: { id: current.id },
        data: { status: "CANCELLED" },
      });
      await tx.leaveAudit.create({
        data: {
          requestId: current.id,
          userId: current.userId,
          actorId: actor.id,
          action: "CANCELLED",
        },
      });
      return { id: current.id };
    }),
  );
}

export async function reviewLeaveRequest(actor, requestId, input) {
  invalidate("leave");
  assertCan(actor, "leaveRequest:review");
  const data = parseInput(leaveReviewSchema, input);

  const reviewed = await withDatabase((db) =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`LeaveRequest\` WHERE \`id\` = ${requestId} FOR UPDATE`;
      const current = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!current) {
        throw new AppError("İzin talebi bulunamadı.", "NOT_FOUND", 404);
      }
      if (current.status !== "PENDING") {
        throw new AppError("Yalnızca bekleyen talepler incelenebilir.", "CONFLICT", 409);
      }

      const unlockEmployee = await lockEmployee(tx, current.userId);
      try {
      let exceptionUsed = false;

      if (data.decision === "APPROVED") {
        const overlap = await tx.leaveRequest.findFirst({
          where: {
            userId: current.userId,
            status: "APPROVED",
            id: { not: current.id },
            startsAt: { lt: current.endsAt },
            endsAt: { gt: current.startsAt },
          },
          select: { id: true },
        });
        if (overlap) {
          throw new AppError("Onaylı bir izinle çakışıyor.", "CONFLICT", 409);
        }

        if (current.type === "ANNUAL" || current.type === "UNPAID") {
          const year = current.startDate.getUTCFullYear();
          await ensureAnnualBalance(tx, current.userId, year);
          const balance = await tx.leaveBalance.findUnique({
            where: { userId_year_type: { userId: current.userId, year, type: "ANNUAL" } },
          });
          if (!balance) {
            if (current.type === "ANNUAL") {
              throw new AppError("Yıllık izin bakiyesi tanımlı değil.", "CONFLICT", 409);
            }
          } else {
            await tx.$queryRaw`SELECT \`id\` FROM \`LeaveBalance\` WHERE \`id\` = ${balance.id} FOR UPDATE`;
            const locked = await tx.leaveBalance.findUnique({ where: { id: balance.id } });
            if (!locked) {
              throw new AppError("Yıllık izin bakiyesi tanımlı değil.", "CONFLICT", 409);
            }
            const nextUsed = new Prisma.Decimal(locked.usedDays).plus(current.dayCount);
            exceptionUsed = nextUsed.greaterThan(locked.allocatedDays);
            if (exceptionUsed && !data.balanceException) {
              throw new AppError(
                "İzin bakiyesi yetersiz. Onay için açık istisna gerekli.",
                "CONFLICT",
                409,
              );
            }
            await tx.leaveBalance.update({
              where: { id: locked.id },
              data: { usedDays: nextUsed },
            });
            await tx.leaveAudit.create({
              data: {
                requestId: current.id,
                userId: current.userId,
                actorId: actor.id,
                action: "BALANCE_DEDUCTED",
                dayDelta: current.dayCount,
                note: exceptionUsed ? "Bakiye istisnası ile düşüldü." : null,
              },
            });
          }
        }
      }

      await tx.leaveRequest.update({
        where: { id: current.id },
        data: {
          status: data.decision,
          reviewNote: data.reviewNote ?? null,
          balanceException: data.decision === "APPROVED" && exceptionUsed,
          reviewerId: actor.id,
          reviewedAt: new Date(),
        },
      });
      await tx.leaveAudit.create({
        data: {
          requestId: current.id,
          userId: current.userId,
          actorId: actor.id,
          action: data.decision === "APPROVED" ? "APPROVED" : "REJECTED",
          note: data.reviewNote,
        },
      });
      return { id: current.id, status: data.decision };
      } finally {
        await unlockEmployee();
      }
    }),
  );
  const employeeNotified = await notifyLeaveDecision(reviewed.id, data.decision);
  return { ...reviewed, employeeNotified };
}

export async function reverseLeaveApproval(actor, requestId, note) {
  invalidate("leave");
  assertCan(actor, "leaveRequest:review");
  const cleanNote = note?.trim() || undefined;

  return withDatabase((db) =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`LeaveRequest\` WHERE \`id\` = ${requestId} FOR UPDATE`;
      const current = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!current) {
        throw new AppError("İzin talebi bulunamadı.", "NOT_FOUND", 404);
      }
      if (current.status !== "APPROVED") {
        throw new AppError("Yalnızca onaylı izin geri alınabilir.", "CONFLICT", 409);
      }

      const unlockEmployee = await lockEmployee(tx, current.userId);
      try {
      if ((current.type === "ANNUAL" || current.type === "UNPAID") && current.settlement !== "SALARY") {
        const year = current.startDate.getUTCFullYear();
        const balance = await tx.leaveBalance.findUnique({
          where: { userId_year_type: { userId: current.userId, year, type: "ANNUAL" } },
        });
        if (!balance) {
          if (current.type === "ANNUAL") {
            throw new AppError("Yıllık izin bakiyesi bulunamadı.", "CONFLICT", 409);
          }
        } else {
          await tx.$queryRaw`SELECT \`id\` FROM \`LeaveBalance\` WHERE \`id\` = ${balance.id} FOR UPDATE`;
          const locked = await tx.leaveBalance.findUnique({ where: { id: balance.id } });
          if (!locked) {
            throw new AppError("Yıllık izin bakiyesi bulunamadı.", "CONFLICT", 409);
          }
          const nextUsed = new Prisma.Decimal(locked.usedDays).minus(current.dayCount);
          if (nextUsed.lessThan(0)) {
            throw new AppError("Bakiye hareketi tutarsız. Geri alma engellendi.", "CONFLICT", 409);
          }
          await tx.leaveBalance.update({
            where: { id: locked.id },
            data: { usedDays: nextUsed },
          });
          await tx.leaveAudit.create({
            data: {
              requestId: current.id,
              userId: current.userId,
              actorId: actor.id,
              action: "BALANCE_RESTORED",
              dayDelta: current.dayCount.negated(),
            },
          });
        }
      }

      await tx.leaveRequest.update({
        where: { id: current.id },
        data: { status: "CANCELLED" },
      });
      await tx.leaveAudit.create({
        data: {
          requestId: current.id,
          userId: current.userId,
          actorId: actor.id,
          action: "REVERSED",
          note: cleanNote,
        },
      });
      return { id: current.id };
      } finally {
        await unlockEmployee();
      }
    }),
  );
}

export async function settleLeaveRequest(actor, requestId, settlement) {
  invalidate("leave");
  assertCan(actor, "leaveRequest:review");

  return withDatabase((db) =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`LeaveRequest\` WHERE \`id\` = ${requestId} FOR UPDATE`;
      const current = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!current) {
        throw new AppError("İzin talebi bulunamadı.", "NOT_FOUND", 404);
      }
      if (current.status !== "APPROVED" || current.type !== "UNPAID") {
        throw new AppError("Bu işaret yalnızca onaylı ücretsiz izin için kullanılır.", "CONFLICT", 409);
      }
      if (current.settlement === settlement) {
        return { id: current.id, settlement, changed: false };
      }

      const unlockEmployee = await lockEmployee(tx, current.userId);
      try {
      await tx.leaveRequest.update({
        where: { id: current.id },
        data: { settlement },
      });
      const year = current.startDate.getUTCFullYear();
      const charge = await approvedBalanceCharge(tx, current.userId, year);
      const balance = await tx.leaveBalance.findUnique({
        where: { userId_year_type: { userId: current.userId, year, type: "ANNUAL" } },
      });
      if (balance) {
        await tx.$queryRaw`SELECT \`id\` FROM \`LeaveBalance\` WHERE \`id\` = ${balance.id} FOR UPDATE`;
        const locked = await tx.leaveBalance.findUnique({ where: { id: balance.id } });
        if (locked && !new Prisma.Decimal(locked.usedDays).equals(charge)) {
          const delta = charge.minus(locked.usedDays);
          await tx.leaveBalance.update({
            where: { id: locked.id },
            data: { usedDays: charge },
          });
          await tx.leaveAudit.create({
            data: {
              requestId: current.id,
              userId: current.userId,
              actorId: actor.id,
              action: delta.greaterThan(0) ? "BALANCE_DEDUCTED" : "BALANCE_RESTORED",
              dayDelta: delta,
            },
          });
        }
      }
      await tx.leaveAudit.create({
        data: {
          requestId: current.id,
          userId: current.userId,
          actorId: actor.id,
          action: settlement === "SALARY" ? "SALARY_SETTLED" : "ANNUAL_SETTLED",
          note: settlement === "SALARY" ? "Maaştan kesildi." : "Yıllık izinden düşüldü.",
        },
      });
      return { id: current.id, settlement, changed: true };
      } finally {
        await unlockEmployee();
      }
    }),
  );
}

export async function setLeaveBalance(actor, input) {
  invalidate("leave");
  assertCan(actor, "leaveBalance:write");
  const data = parseInput(leaveBalanceSchema, input);

  return withDatabase((db) =>
    db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: data.userId },
        select: { id: true },
      });
      if (!user) {
        throw new AppError("Kullanıcı bulunamadı.", "NOT_FOUND", 404);
      }
      const unlockEmployee = await lockEmployee(tx, data.userId);
      try {
      const existing = await tx.leaveBalance.findUnique({
        where: {
          userId_year_type: { userId: data.userId, year: data.year, type: "ANNUAL" },
        },
      });
      if (
        existing &&
        new Prisma.Decimal(data.allocatedDays).lessThan(existing.usedDays) &&
        !data.allowBelowUsed
      ) {
        throw new AppError(
          "Tanımlanan bakiye kullanılan günden az. Kayıt için açık istisna gerekli.",
          "CONFLICT",
          409,
        );
      }

      const balance = await tx.leaveBalance.upsert({
        where: {
          userId_year_type: { userId: data.userId, year: data.year, type: "ANNUAL" },
        },
        create: {
          userId: data.userId,
          year: data.year,
          type: "ANNUAL",
          allocatedDays: data.allocatedDays,
        },
        update: { allocatedDays: data.allocatedDays },
      });
      await tx.leaveAudit.create({
        data: {
          userId: data.userId,
          actorId: actor.id,
          action: "BALANCE_SET",
          dayDelta: data.allocatedDays,
          note: `${data.year} yıllık izin bakiyesi`,
        },
      });
      return {
        id: balance.id,
        allocatedDays: balance.allocatedDays.toFixed(2),
        usedDays: balance.usedDays.toFixed(2),
      };
      } finally {
        await unlockEmployee();
      }
    }),
  );
}

export async function updateLeaveCalendar(actor, input) {
  invalidate("leave");
  assertCan(actor, "leaveBalance:write");
  const data = parseInput(leaveCalendarSchema, input);
  const weekendDays = [...new Set(data.weekendDays)].sort((left, right) => left - right);

  const settings = await withDatabase((db) =>
    db.leaveSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        hoursPerDay: data.hoursPerDay,
        weekendDays,
      },
      update: {
        hoursPerDay: data.hoursPerDay,
        weekendDays,
      },
    }),
  );
  return {
    hoursPerDay: settings.hoursPerDay.toFixed(2),
    weekendDays: numberList(settings.weekendDays),
  };
}

export async function addLeaveHoliday(actor, input) {
  invalidate("leave");
  assertCan(actor, "leaveBalance:write");
  const data = parseInput(leaveHolidaySchema, input);
  try {
    return await withDatabase((db) =>
      db.leaveHoliday.create({
        data: {
          date: dateOnly(data.date),
          name: data.name,
        },
        select: { id: true, name: true },
      }),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "CONFLICT") {
      throw new AppError("Bu tarih için tatil zaten var.", "CONFLICT", 409);
    }
    throw error;
  }
}

export async function setLeaveHolidayActive(actor, holidayId, active) {
  invalidate("leave");
  assertCan(actor, "leaveBalance:write");
  try {
    return await withDatabase((db) =>
      db.leaveHoliday.update({
        where: { id: holidayId },
        data: { active },
        select: { id: true, active: true },
      }),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      throw new AppError("Tatil kaydı bulunamadı.", "NOT_FOUND", 404);
    }
    throw error;
  }
}

export async function openLeaveDocument(actor, documentId) {
  assertNotMealOnly(actor);
  assertCan(actor, "leaveRequest:read:own");
  const document = await withDatabase((db) =>
    db.leaveDocument.findUnique({
      where: { id: documentId },
      include: { request: { select: { userId: true } } },
    }),
  );
  if (!document || (actor.role !== "ADMIN" && document.request.userId !== actor.id)) {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
  const bytes = await readLeaveFile(document.storageKey);
  return {
    bytes,
    fileName: document.fileName,
    contentType: document.contentType,
  };
}

function reportWindow(mode, period) {
  if (mode === "day" || mode === "week") {
    return reportRange(mode, period.slice(0, 10));
  }
  if (mode === "year") {
    const year = period.slice(0, 4);
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const [year, month] = period.split("-");
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}
