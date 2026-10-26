import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { assertCan } from "@/server/auth/permissions";
import { dateOnly, formatIstanbulDateTime, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { cardsForScope, isSpenderName, SPENDER_NAMES, summarizeCards } from "@/server/finance/cards";
import {
  categoryFitsScope,
  normalizeAccountLabel,
  redactAccountLabel,
  summarizePending,
  summarizeScopes,
  summarizeSpend,
  vendorKey,



} from "@/server/finance/catalog";
import {
  inspectFinanceFile,
  readFinanceFile,
  removeFinanceFile,
  saveFinanceFile,
} from "@/server/finance/documents";
import { googleConnectionReport, planDriveArchive } from "@/server/finance/google";
import { readGoogleLink } from "@/server/google/account";
import { aiFailureMessage, requestDocumentAi } from "@/server/finance/documentAi";
import { documentHash } from "@/server/finance/pdfText";
import { analyzeFinanceDocument, applyAiPayload, documentIntelligence, interpretFinanceText } from "@/server/finance/readDocument";
import { storeZip } from "@/server/finance/zip";
import {
  expenseFilterSchema,
  expenseReviewSchema,
  expenseSchema,
  expenseUpdateSchema,
  invoiceSchema,
  parseInput,
  subscriptionSchema,
} from "@/server/validation/schemas";



const expenseInclude = {
  user: { select: { id: true, name: true } },
  document: { select: { id: true, fileName: true } },
  invoice: {
    select: {
      id: true,
      number: true,
      vendor: true,
      amount: true,
      currency: true,
      spenderName: true,
      document: { select: { id: true } },
    },
  },
  audits: {
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { actor: { select: { name: true } } },
  },
} ;

function emptyToUndefined(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertScopeCategory(scope, category) {
  if (!categoryFitsScope(scope, category)) {
    throw new AppError("Bu kategori seçilen gider türüne ait değil.", "VALIDATION", 400);
  }
}

const FINANCIAL_FIELDS = [
  "spentOn",
  "category",
  "vendor",
  "amount",
  "currency",
  "paymentMethod",
  "accountLabel",
  "reimbursement",
  "userId",
] ;



function accountLabelOrThrow(paymentMethod, value) {
  const normalized = normalizeAccountLabel(paymentMethod, value);
  if (normalized.error) throw new AppError(normalized.error, "VALIDATION", 400);
  return normalized.value;
}

function snapshot(expense













) {
  const spentOn = expense.spentOn instanceof Date ? toIsoDate(expense.spentOn) : expense.spentOn;
  const amount = typeof expense.amount === "string" ? expense.amount : expense.amount.toString();
  return {
    userId: expense.userId,
    category: expense.category,
    title: expense.title,
    vendor: expense.vendor,
    amount: Number(amount).toFixed(2),
    currency: expense.currency,
    paymentMethod: expense.paymentMethod,
    accountLabel: redactAccountLabel(expense.accountLabel),
    spentOn,
    status: expense.status,
    reimbursement: expense.reimbursement,
    note: expense.note,
    invoiceId: expense.invoiceId,
  };
}

function diff(before, after) {
  const changes = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const left = before[key] ?? null;
    const right = after[key] ?? null;
    if (left !== right) changes[key] = { before: left, after: right };
  }
  return changes;
}

function auditChanges(value) {
  if (!value || typeof value !== "object") return {};
  const changes = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== "object") continue;
    const record = item ;
    changes[key] = {
      before: redactField(key, record.before),
      after: redactField(key, record.after),
    };
  }
  return changes;
}

function redactField(key, value) {
  if (value == null || value === "") return null;
  const text = String(value);
  return key === "accountLabel" ? redactAccountLabel(text) : text;
}

async function writeAudit(
  tx,
  actorId,
  expenseId,
  action,
  changes,
) {
  if (Object.keys(changes).length === 0) return;
  await tx.expenseAudit.create({
    data: { expenseId, actorId, action, changes },
  });
}

async function spenderId(
  db,
  actor,
  requested,
) {
  if (actor.role !== "ADMIN" || !requested || requested === actor.id) return actor.id;
  const user = await db.user.findFirst({
    where: { id: requested },
    select: { id: true, active: true, name: true },
  });
  if (!user || (!user.active && !isSpenderName(user.name))) {
    throw new AppError("Harcayan kişi bulunamadı.", "VALIDATION", 400);
  }
  return user.id;
}

async function assertInvoiceLink(
  db,
  invoiceId,
  expense,
) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      review: { select: { status: true, archived: true } },
      expenses: { select: { id: true } },
    },
  });
  if (!invoice || invoice.review?.status !== "APPROVED" || invoice.review.archived !== true) {
    throw new AppError("Yalnızca onaylanmış ve arşivlenmiş fatura eşleştirilebilir.", "VALIDATION", 400);
  }
  if (invoice.scope !== expense.scope) {
    throw new AppError("Fatura bu gider türüne ait değil.", "VALIDATION", 400);
  }
  if (invoice.expenses.some((item) => item.id !== expense.id)) {
    throw new AppError("Bu fatura başka bir giderle eşleştirilmiş.", "CONFLICT", 409);
  }
  if ((invoice.currency !== expense.currency || !sameMoney(invoice.amount, expense.amount)) && !expense.accept) {
    throw new AppError(
      `Fatura tutarı ${Number(invoice.amount.toString()).toFixed(2)} ${invoice.currency}, gider ${Number(expense.amount).toFixed(2)} ${expense.currency}. Farkı onaylamadan bağlantı kurulmaz.`,
      "VALIDATION",
      400,
    );
  }
}

export async function getExpensePage(
  actor,
  scope,
  input,
) {
  assertCan(actor, scope === "EMPLOYEE" ? "expense:read:own" : "expense:read:all");
  const filters = parseInput(expenseFilterSchema, input);
  const month = filters.month ?? istanbulToday().slice(0, 7);
  const year = filters.year ?? month.slice(0, 4);
  const where = {
    scope,
    ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
    ...(actor.role === "ADMIN" && filters.userId ? { userId: filters.userId } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.from || filters.to
      ? {
          spentOn: {
            ...(filters.from ? { gte: dateOnly(filters.from) } : {}),
            ...(filters.to ? { lte: dateOnly(filters.to) } : {}),
          },
        }
      : {}),
  };
  const periodWhere = {
    ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
    ...(filters.currency ? { currency: filters.currency } : {}),
  };

  return withDatabase(async (db) => {
    const [expenses, people, spenders, monthRows, yearRows, scopeRows, cardRows, invoices, selected] = await Promise.all([
      db.expense.findMany({
        where,
        include: expenseInclude,
        orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      }),
      actor.role === "ADMIN"
        ? db.user.findMany({
            where: { active: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      db.user.findMany({
        where: { name: { in: [...SPENDER_NAMES] } },
        select: { id: true, name: true },
      }),
      db.expense.findMany({
        where: {
          scope,
          spentOn: {
            gte: dateOnly(`${month}-01`),
            lte: dateOnly(lastDay(month)),
          },
          ...periodWhere,
        },
        select: {
          amount: true,
          currency: true,
          status: true,
          vendor: true,
          paymentMethod: true,
          category: true,
          reimbursement: true,
          scope: true,
        },
      }),
      db.expense.findMany({
        where: {
          scope,
          spentOn: {
            gte: dateOnly(`${year}-01-01`),
            lte: dateOnly(`${year}-12-31`),
          },
          ...periodWhere,
        },
        select: {
          amount: true,
          currency: true,
          status: true,
          vendor: true,
          paymentMethod: true,
          category: true,
          reimbursement: true,
          scope: true,
        },
      }),
      actor.role === "ADMIN"
        ? db.expense.findMany({
            where: {
              scope: { in: ["COMPANY", "OFFICE"] },
              status: { in: ["APPROVED", "PAID"] },
              spentOn: {
                gte: dateOnly(`${month}-01`),
                lte: dateOnly(lastDay(month)),
              },
              ...(filters.currency ? { currency: filters.currency } : {}),
            },
            select: { amount: true, currency: true, status: true, scope: true, vendor: true, paymentMethod: true },
          })
        : Promise.resolve([]),
      db.expense.findMany({
        where: {
          scope,
          status: { in: ["APPROVED", "PAID"] },
          spentOn: {
            gte: dateOnly(`${month}-01`),
            lte: dateOnly(lastDay(month)),
          },
          ...periodWhere,
        },
        select: { amount: true, currency: true, accountLabel: true },
      }),
      actor.role === "ADMIN" && scope !== "EMPLOYEE"
        ? db.invoice.findMany({
            where: {
              scope,
              review: { is: { status: "APPROVED", archived: true } },
            },
            select: {
              id: true,
              number: true,
              vendor: true,
              amount: true,
              currency: true,
              scope: true,
              expenses: { select: { id: true } },
            },
            orderBy: { issuedOn: "desc" },
            take: 100,
          })
        : Promise.resolve([]),
      filters.expenseId
        ? db.expense.findFirst({
            where: {
              id: filters.expenseId,
              scope,
              ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
            },
            include: expenseInclude,
          })
        : Promise.resolve(null),
    ]);
    const monthMapped = monthRows.map(moneyRow);

    return {
      scope,
      month,
      year,
      filters,
      people,
      spenders: [...spenders].sort(
        (left, right) =>
          SPENDER_NAMES.indexOf(left.name ) -
          SPENDER_NAMES.indexOf(right.name ),
      ),
      monthReport: summarizeSpend(monthMapped),
      yearReport: summarizeSpend(yearRows.map(moneyRow)),
      pendingReport: summarizePending(monthMapped),
      scopeReport: summarizeScopes(scopeRows.map(moneyRow)),
      cardReport: summarizeCards(
        cardRows.map((row) => ({
          amount: row.amount.toString(),
          currency: row.currency,
          accountLabel: row.accountLabel,
        })),
        cardsForScope(scope),
      ),
      invoices: invoices.map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          vendor: invoice.vendor,
          amount: Number(invoice.amount.toString()).toFixed(2),
          currency: invoice.currency,
          linkedExpenseId: invoice.expenses[0]?.id ?? null,
        })),
      selected: selected ? presentExpense(selected) : null,
      expenses: expenses.map(presentExpense),
    };
  });
}

function moneyRow(row








) {
  return {
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status,
    vendor: row.vendor,
    paymentMethod: row.paymentMethod,
    category: row.category,
    reimbursement: row.reimbursement,
    scope: row.scope,
  };
}

function presentExpense(expense





























) {
  return {
    id: expense.id,
    userId: expense.user.id,
    userName: expense.invoice?.spenderName || expense.user.name,
    scope: expense.scope,
    category: expense.category,
    title: expense.title,
    vendor: expense.vendor,
    amount: Number(expense.amount.toString()).toFixed(2),
    currency: expense.currency,
    paymentMethod: expense.paymentMethod,
    accountLabel: redactAccountLabel(expense.accountLabel),
    spentOn: toIsoDate(expense.spentOn),
    status: expense.status,
    reimbursement: expense.reimbursement,
    source: expense.source,
    note: expense.note,
    reviewNote: expense.reviewNote,
    createdAt: formatIstanbulDateTime(expense.createdAt),
    recordedAt: expense.createdAt.toISOString(),
    updatedAt: formatIstanbulDateTime(expense.updatedAt),
    invoice: expense.invoice
      ? {
          id: expense.invoice.id,
          number: expense.invoice.number,
          vendor: expense.invoice.vendor,
          amount: Number(expense.invoice.amount.toString()).toFixed(2),
          currency: expense.invoice.currency,
          documentId: expense.invoice.document?.id ?? null,
        }
      : null,
    document: expense.document,
    audits: expense.audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      actorName: audit.actor.name,
      createdAt: formatIstanbulDateTime(audit.createdAt),
      changes: auditChanges(audit.changes),
    })),
  };
}

function paymentText(method) {
  if (method === "CARD") return "Kredi kartı";
  if (method === "TRANSFER") return "Banka havalesi";
  if (method === "CASH") return "Nakit";
  if (method === "OTHER") return "Diğer";
  return "";
}

function lastDay(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return date.toISOString().slice(0, 10);
}

export async function createExpense(actor, input, file) {
  assertNotMealOnly(actor);
  const data = parseInput(expenseSchema, input);
  assertScopeCategory(data.scope, data.category);
  if (data.scope === "EMPLOYEE") {
    assertCan(actor, "expense:create:own");
  } else {
    assertCan(actor, "expense:create:company");
  }
  if (actor.role !== "ADMIN" && (data.invoiceId || (data.userId && data.userId !== actor.id))) {
    throw new AppError("Bu alan yalnızca yönetici tarafından değiştirilebilir.", "FORBIDDEN", 403);
  }
  const accountLabel = accountLabelOrThrow(data.paymentMethod, data.accountLabel);
  const inspected = file && file.bytes.length > 0 ? inspectFinanceFile(file) : null;
  const reimbursement = data.reimbursement ?? (data.scope === "EMPLOYEE" ? "PENDING" : "NOT_REQUIRED");

  const expense = await withDatabase(async (db) => {
    const userId = await spenderId(db, actor, data.userId);
    if (data.invoiceId) {
      await assertInvoiceLink(db, data.invoiceId, {
        scope: data.scope,
        amount: data.amount,
        currency: data.currency,
        accept: data.acceptAmountDifference === true,
      });
    }
    return db.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          userId,
          scope: data.scope,
          category: data.category,
          title: data.title,
          vendor: emptyToUndefined(data.vendor) ?? null,
          amount: data.amount,
          currency: data.currency,
          paymentMethod: data.paymentMethod,
          accountLabel,
          spentOn: dateOnly(data.spentOn),
          status: data.scope === "EMPLOYEE" ? "SUBMITTED" : "APPROVED",
          reimbursement,
          source: inspected ? "UPLOAD" : "MANUAL",
          note: emptyToUndefined(data.note) ?? null,
          invoiceId: data.invoiceId ?? null,
          reviewerId: data.scope === "EMPLOYEE" ? null : actor.id,
          reviewedAt: data.scope === "EMPLOYEE" ? null : new Date(),
        },
      });
      await writeAudit(tx, actor.id, created.id, "CREATE", diff({}, snapshot(created)));
      if (created.invoiceId) {
        await writeAudit(tx, actor.id, created.id, "LINK_INVOICE", {
          invoiceId: { before: null, after: created.invoiceId },
        });
      }
      return created;
    });
  });

  if (!inspected) {
    return { id: expense.id, warning: null  };
  }

  const storageKey = randomBytes(16).toString("hex");
  try {
    await saveFinanceFile(storageKey, inspected.bytes);
    await withDatabase((db) =>
      db.expenseDocument.create({
        data: {
          expenseId: expense.id,
          storageKey,
          fileName: inspected.fileName,
          contentType: inspected.contentType,
          sizeBytes: inspected.bytes.length,
        },
      }),
    );
  } catch (error) {
    await removeFinanceFile(storageKey);
    if (error instanceof AppError) {
      throw error;
    }
    return { id: expense.id, warning: "Harcama kaydedildi, belge saklanamadı." };
  }

  return { id: expense.id, warning: null };
}

export async function updateExpense(actor, expenseId, input) {
  const data = parseInput(expenseUpdateSchema, input);
  if (actor.role === "ADMIN") assertCan(actor, "expense:review");
  else assertCan(actor, "expense:create:own");
  const accountLabel = accountLabelOrThrow(data.paymentMethod, data.accountLabel);

  await withDatabase((db) =>
    db.$transaction(async (tx) => {
      const current = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!current || (actor.role !== "ADMIN" && current.userId !== actor.id)) {
        throw new AppError("Harcama bulunamadı.", "NOT_FOUND", 404);
      }
      assertScopeCategory(current.scope, data.category);
      const userId = actor.role === "ADMIN"
        ? await spenderId(tx, actor, data.userId ?? current.userId)
        : current.userId;
      if (actor.role !== "ADMIN" && data.invoiceId && data.invoiceId !== current.invoiceId) {
        throw new AppError("Fatura eşleştirmesi yalnızca yöneticiye açıktır.", "FORBIDDEN", 403);
      }
      const nextInvoiceId = actor.role === "ADMIN"
        ? data.invoiceId === undefined ? current.invoiceId : data.invoiceId
        : current.invoiceId;
      const reimbursement = data.reimbursement ?? current.reimbursement;
      const before = snapshot(current);
      const draft = {
        ...before,
        userId,
        category: data.category,
        title: data.title,
        vendor: emptyToUndefined(data.vendor) ?? null,
        amount: Number(data.amount).toFixed(2),
        currency: data.currency,
        paymentMethod: data.paymentMethod,
        accountLabel,
        spentOn: data.spentOn,
        reimbursement,
        note: emptyToUndefined(data.note) ?? null,
        invoiceId: nextInvoiceId,
      };
      const locked = current.status === "APPROVED" || current.status === "PAID";
      const financialChanged = FINANCIAL_FIELDS.some((field) => before[field] !== draft[field]);
      if (locked && financialChanged && actor.role !== "ADMIN") {
        throw new AppError(
          "Onaylı veya ödenmiş giderin finansal alanlarını yalnızca yönetici değiştirebilir.",
          "FORBIDDEN",
          403,
        );
      }
      if (nextInvoiceId && nextInvoiceId !== current.invoiceId) {
        await assertInvoiceLink(tx, nextInvoiceId, {
          id: current.id,
          scope: current.scope,
          amount: data.amount,
          currency: data.currency,
          accept: actor.role === "ADMIN" && data.acceptAmountDifference === true,
        });
      }
      let next;
      try {
        next = await tx.expense.update({
          where: { id: current.id },
          data: {
            userId,
            category: data.category,
            title: data.title,
            vendor: draft.vendor,
            amount: data.amount,
            currency: data.currency,
            paymentMethod: data.paymentMethod,
            accountLabel,
            spentOn: dateOnly(data.spentOn),
            reimbursement,
            note: draft.note,
            invoiceId: nextInvoiceId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError("Bu fatura başka bir giderle eşleştirilmiş.", "CONFLICT", 409);
        }
        throw error;
      }
      const after = snapshot(next);
      const fieldDiff = diff(before, after);
      delete fieldDiff.invoiceId;
      await writeAudit(tx, actor.id, current.id, "UPDATE", fieldDiff);
      if ((before.invoiceId ?? null) !== (after.invoiceId ?? null)) {
        if (before.invoiceId) {
          await writeAudit(tx, actor.id, current.id, "UNLINK_INVOICE", {
            invoiceId: { before: before.invoiceId, after: null },
          });
        }
        if (after.invoiceId) {
          await writeAudit(tx, actor.id, current.id, "LINK_INVOICE", {
            invoiceId: { before: null, after: after.invoiceId },
          });
        }
      }
    }),
  );
  return { id: expenseId };
}

export async function reviewExpense(actor, expenseId, input) {
  assertCan(actor, "expense:review");
  const data = parseInput(expenseReviewSchema, input);
  await withDatabase((db) =>
    db.$transaction(async (tx) => {
      const current = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!current || current.status !== "SUBMITTED") {
        throw new AppError("Yalnızca incelemedeki harcama sonuçlandırılabilir.", "CONFLICT", 409);
      }
      const next = await tx.expense.update({
        where: { id: current.id },
        data: {
          status: data.decision,
          reimbursement: data.decision === "REJECTED" ? "NOT_REQUIRED" : current.reimbursement,
          reviewNote: emptyToUndefined(data.reviewNote) ?? null,
          reviewerId: actor.id,
          reviewedAt: new Date(),
        },
      });
      await writeAudit(
        tx,
        actor.id,
        current.id,
        data.decision === "APPROVED" ? "APPROVE" : "REJECT",
        diff(snapshot(current), snapshot(next)),
      );
    }),
  );
  return { id: expenseId, status: data.decision };
}

export async function markExpensePaid(actor, expenseId) {
  assertCan(actor, "expense:review");
  await withDatabase(async (db) => {
    const expense = await db.expense.findUnique({ where: { id: expenseId } });
    if (!expense) {
      throw new AppError("Harcama bulunamadı.", "NOT_FOUND", 404);
    }
    if (expense.status !== "APPROVED") {
      throw new AppError("Ödeme yalnızca onaylı harcamaya işlenir.", "CONFLICT", 409);
    }
    const paid = await db.$transaction(async (tx) => {
      const updated = await tx.expense.updateMany({
        where: { id: expense.id, status: "APPROVED" },
        data: {
          status: "PAID",
          reimbursement: expense.scope === "EMPLOYEE" ? "PAID" : expense.reimbursement,
          reviewerId: actor.id,
          reviewedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new AppError("Ödeme kaydı güncellenemedi.", "CONFLICT", 409);
      }
      const next = await tx.expense.findUniqueOrThrow({ where: { id: expense.id } });
      await writeAudit(tx, actor.id, expense.id, "MARK_PAID", diff(snapshot(expense), snapshot(next)));
      return updated;
    });
    if (paid.count !== 1) {
      throw new AppError("Ödeme kaydı güncellenemedi.", "CONFLICT", 409);
    }
  });
  return { id: expenseId, status: "PAID"  };
}

export async function setExpenseSettlement(actor, expenseId, paid) {
  assertCan(actor, "expense:review");
  await withDatabase(async (db) => {
    const expense = await db.expense.findUnique({ where: { id: expenseId } });
    if (!expense) {
      throw new AppError("Harcama bulunamadı.", "NOT_FOUND", 404);
    }
    if (expense.status === "REJECTED" || expense.status === "SUBMITTED") {
      throw new AppError("Ödeme durumu yalnızca onaylı harcamada değişir.", "CONFLICT", 409);
    }
    const nextStatus = paid ? "PAID" : "APPROVED";
    const nextReimbursement = paid ? "PAID" : "PENDING";
    if (expense.status === nextStatus && expense.reimbursement === nextReimbursement) return;
    await db.$transaction(async (tx) => {
      const updated = await tx.expense.updateMany({
        where: { id: expense.id, status: expense.status, reimbursement: expense.reimbursement },
        data: {
          status: nextStatus,
          reimbursement: nextReimbursement,
          reviewerId: actor.id,
          reviewedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new AppError("Ödeme durumu güncellenemedi.", "CONFLICT", 409);
      }
      const next = await tx.expense.findUniqueOrThrow({ where: { id: expense.id } });
      await writeAudit(tx, actor.id, expense.id, paid ? "MARK_PAID" : "MARK_UNPAID", diff(snapshot(expense), snapshot(next)));
    });
  });
}

export async function getInvoicePage(actor, month, scope) {
  assertCan(actor, "invoice:read");
  const period = /^\d{4}-\d{2}$/.test(month) ? month : istanbulToday().slice(0, 7);
  return withDatabase(async (db) => {
    const link = await readGoogleLink(db);
    const [invoices, expenses, cardRows] = await Promise.all([
      db.invoice.findMany({
        where: {
          ...(scope ? { scope } : {}),
          issuedOn: {
            gte: dateOnly(`${period}-01`),
            lte: dateOnly(lastDay(period)),
          },
        },
        include: {
          document: { select: { id: true, fileName: true } },
          expenses: {
            select: {
              id: true,
              title: true,
              scope: true,
              paymentMethod: true,
              accountLabel: true,
              user: { select: { name: true } },
            },
          },
        },
        orderBy: [{ issuedOn: "asc" }, { createdAt: "asc" }],
      }),
      db.expense.findMany({
        where: { invoiceId: null, scope: scope ?? { in: ["COMPANY", "OFFICE"] } },
        select: { id: true, title: true, scope: true, amount: true, currency: true, spentOn: true },
        orderBy: { spentOn: "desc" },
        take: 100,
      }),
      scope
        ? db.expense.findMany({
            where: {
              scope,
              status: { in: ["APPROVED", "PAID"] },
              spentOn: {
                gte: dateOnly(`${period}-01`),
                lte: dateOnly(lastDay(period)),
              },
            },
            select: { amount: true, currency: true, accountLabel: true, status: true, vendor: true, paymentMethod: true },
          })
        : Promise.resolve([]),
    ]);
    const counted = cardRows.map(moneyRow);
    return {
      month: period,
      cards: summarizeCards(
        cardRows.map((row) => ({
          amount: row.amount.toString(),
          currency: row.currency,
          accountLabel: row.accountLabel,
        })),
        scope ? cardsForScope(scope) : [],
      ),
      totals: summarizeSpend(counted).byCurrency,
      transfers: summarizeSpend(counted.filter((row) => row.paymentMethod === "TRANSFER")).byCurrency,
      google: googleConnectionReport(link),
      unlinkedExpenses: expenses.map((expense) => ({
        id: expense.id,
        title: expense.title,
        scope: expense.scope,
        amount: expense.amount.toString(),
        currency: expense.currency,
        spentOn: toIsoDate(expense.spentOn),
      })),
      invoices: invoices.map((invoice) => {
        const expense = invoice.expenses[0];
        const amount = Number(invoice.amount.toString());
        return {
        id: invoice.id,
        number: invoice.number,
        vendor: invoice.vendor,
        scope: invoice.scope,
        amount: amount.toFixed(2),
        currency: invoice.currency,
        description: expense?.title || invoice.note || "",
        quantity: invoice.quantity,
        paymentLabel: paymentText(expense?.paymentMethod ?? invoice.paymentMethod),
        card: redactAccountLabel(expense?.accountLabel ?? invoice.accountLabel) ?? "",
        person: invoice.spenderName || expense?.user?.name || "",
        issuedOn: toIsoDate(invoice.issuedOn),
        dueOn: invoice.dueOn ? toIsoDate(invoice.dueOn) : null,
        status: invoice.status,
        source: invoice.source,
        note: invoice.note,
        document: invoice.document,
        expenses: invoice.expenses,
        archive: planDriveArchive({
          issuedOn: toIsoDate(invoice.issuedOn),
          vendor: invoice.vendor,
          number: invoice.number,
        }),
        };
      }),
    };
  });
}

export async function createInvoice(actor, input, file) {
  assertCan(actor, "invoice:write");
  const data = parseInput(invoiceSchema, input);
  assertScopeCategory(data.scope, data.category);
  if (data.spenderName && !isSpenderName(data.spenderName)) {
    throw new AppError("Harcamayı yapan kişi listede yok.", "VALIDATION", 400);
  }
  if (data.createExpense) {
    throw new AppError(
      "Fatura kaydı gider oluşturmaz. Gideri gider sayfasından ekleyip faturayı oradan eşleştirin.",
      "VALIDATION",
      400,
    );
  }

  let extractedWarning = null;
  let source = "MANUAL";
  let inspected = null;
  if (file && file.bytes.length > 0) {
    inspected = inspectFinanceFile(file);
    source = "UPLOAD";
    const reading = documentIntelligence().read({
      bytes: inspected.bytes,
      fileName: inspected.fileName,
    });
    if (reading.kind === "NOT_INVOICE" || reading.kind === "STATEMENT") {
      throw new AppError(reading.warnings[0] ?? "Bu belge fatura değil.", "VALIDATION", 400);
    }
    extractedWarning = reading.warnings[0] ?? null;
  }

  const key = vendorKey(data.vendor);
  const storageKey = inspected ? randomBytes(16).toString("hex") : null;
  try {
    const invoice = await withDatabase((db) =>
      db.$transaction(async (tx) => {
        const created = await tx.invoice.create({
          data: {
            number: data.number.trim(),
            vendor: data.vendor.trim(),
            vendorKey: key,
            scope: data.scope,
            amount: data.amount,
            currency: data.currency,
            issuedOn: dateOnly(data.issuedOn),
            dueOn: data.dueOn ? dateOnly(data.dueOn) : null,
            source,
            note: emptyToUndefined(data.note) ?? null,
            paymentMethod: data.paymentMethod,
            accountLabel: emptyToUndefined(data.accountLabel) ?? null,
            spenderName: emptyToUndefined(data.spenderName) ?? null,
          },
        });

        if (data.expenseId) {
          const expense = await tx.expense.findUnique({ where: { id: data.expenseId } });
          if (!expense || expense.scope !== data.scope) {
            throw new AppError("Bağlanacak harcama bu gider türünde değil.", "VALIDATION", 400);
          }
          if (expense.invoiceId) {
            throw new AppError("Bu harcamanın faturası zaten var.", "CONFLICT", 409);
          }
          if (expense.currency !== data.currency || !sameMoney(expense.amount, data.amount)) {
            throw new AppError(
              "Fatura tutarı ve para birimi harcamayla aynı olmalı. Aynı gider iki kez sayılmaz.",
              "VALIDATION",
              400,
            );
          }
          const linked = await tx.expense.updateMany({
            where: { id: expense.id, invoiceId: null },
            data: { invoiceId: created.id },
          });
          if (linked.count !== 1) {
            throw new AppError("Harcama bağlanamadı.", "CONFLICT", 409);
          }
          await writeAudit(tx, actor.id, expense.id, "LINK_INVOICE", {
            invoiceId: { before: null, after: created.id },
          });
        }

        return { invoice: created, expenseId: null  };
      }),
    );

    if (inspected && storageKey) {
      try {
        await saveFinanceFile(storageKey, inspected.bytes);
        await withDatabase((db) =>
          db.invoiceDocument.create({
            data: {
              invoiceId: invoice.invoice.id,
              storageKey,
              fileName: inspected.fileName,
              contentType: inspected.contentType,
              sizeBytes: inspected.bytes.length,
              contentHash: documentHash(inspected.bytes),
            },
          }),
        );
      } catch (error) {
        await removeFinanceFile(storageKey);
        await withDatabase(async (db) => {
          if (invoice.expenseId) {
            await db.expense.delete({ where: { id: invoice.expenseId } });
          }
          await db.invoice.delete({ where: { id: invoice.invoice.id } });
        });
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError("Fatura belgesi saklanamadı.", "DATABASE_UNAVAILABLE", 503);
      }
    }

    return { id: invoice.invoice.id, warning: extractedWarning };
  } catch (error) {
    if (error instanceof AppError && error.message === "Bu kayıt zaten var.") {
      throw new AppError("Bu tedarikçi ve fatura numarası zaten kayıtlı.", "CONFLICT", 409);
    }
    throw error;
  }
}

export async function importFlyworkInvoiceFile(actor, file) {
  assertCan(actor, "invoice:write");
  assertCan(actor, "expense:create:company");
  const inspected = inspectFinanceFile(file);
  const hash = documentHash(inspected.bytes);
  const duplicate = await withDatabase((db) =>
    db.invoiceDocument.findUnique({ where: { contentHash: hash }, select: { id: true } }),
  );
  if (duplicate) {
    throw new AppError("Bu fatura zaten kayıtlı.", "CONFLICT", 409);
  }

  const reading = await readUploadedInvoice(inspected);
  if (reading.kind === "STATEMENT" || reading.kind === "NOT_INVOICE") {
    throw new AppError(reading.warnings[0] ?? "Bu belge fatura olarak kaydedilmez.", "VALIDATION", 400);
  }
  if (reading.aiState === "FAILED" || reading.aiState === "WAITING_CONNECTION") {
    throw new AppError(reading.warnings[0] ?? "Fatura okunamadı. Alanlar tahmin edilmedi.", "VALIDATION", 400);
  }
  const vendor = reading.fields.vendor?.trim() ?? "";
  const number = reading.fields.number?.trim() ?? "";
  const issuedOn = reading.fields.issuedOn ?? "";
  const amount = reading.fields.amount ?? "";
  const currency = reading.fields.currency;
  const missing = [];
  if (vendor.length < 2) missing.push("tedarikçi");
  if (number.length < 1) missing.push("fatura numarası");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) missing.push("tarih");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount)) missing.push("tutar");
  if (currency !== "TRY" && currency !== "USD" && currency !== "EUR") missing.push("para birimi");
  if (reading.kind !== "INVOICE" && reading.kind !== "RECEIPT") missing.push("belge türü");
  if (missing.length > 0) {
    throw new AppError(`Fatura okundu ama ${missing.join(", ")} net değil. Kayıt oluşturulmadı.`, "VALIDATION", 400);
  }
  if (currency !== "TRY" && currency !== "USD" && currency !== "EUR") {
    throw new AppError("Fatura okundu ama para birimi net değil. Kayıt oluşturulmadı.", "VALIDATION", 400);
  }

  const invoiceKey = randomBytes(16).toString("hex");
  const expenseKey = randomBytes(16).toString("hex");
  try {
    await saveFinanceFile(invoiceKey, inspected.bytes);
    await saveFinanceFile(expenseKey, inspected.bytes);
    await withDatabase((db) =>
      db.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            number,
            vendor,
            vendorKey: vendorKey(vendor),
            scope: "COMPANY",
            amount,
            currency,
            issuedOn: dateOnly(issuedOn),
            source: "UPLOAD",
            note: null,
            paymentMethod: "OTHER",
            spenderName: actor.name,
          },
        });
        const expense = await tx.expense.create({
          data: {
            userId: actor.id,
            scope: "COMPANY",
            category: "OTHER",
            title: vendor.slice(0, 160),
            vendor,
            amount,
            currency,
            paymentMethod: "OTHER",
            spentOn: dateOnly(issuedOn),
            status: "APPROVED",
            reimbursement: "NOT_REQUIRED",
            source: "UPLOAD",
            note: `Fatura ${number}`,
            invoiceId: invoice.id,
            reviewerId: actor.id,
            reviewedAt: new Date(),
          },
        });
        await writeAudit(tx, actor.id, expense.id, "CREATE", diff({}, snapshot(expense)));
        await writeAudit(tx, actor.id, expense.id, "LINK_INVOICE", {
          invoiceId: { before: null, after: invoice.id },
        });
        await tx.invoiceDocument.create({
          data: {
            invoiceId: invoice.id,
            storageKey: invoiceKey,
            fileName: inspected.fileName,
            contentType: inspected.contentType,
            sizeBytes: inspected.bytes.length,
            contentHash: hash,
          },
        });
        await tx.expenseDocument.create({
          data: {
            expenseId: expense.id,
            storageKey: expenseKey,
            fileName: inspected.fileName,
            contentType: inspected.contentType,
            sizeBytes: inspected.bytes.length,
          },
        });
      }),
    );
  } catch (error) {
    await removeFinanceFile(invoiceKey);
    await removeFinanceFile(expenseKey);
    if (error instanceof AppError && error.message === "Bu kayıt zaten var.") {
      throw new AppError("Bu tedarikçi ve fatura numarası zaten kayıtlı.", "CONFLICT", 409);
    }
    throw error;
  }

  return { vendor, number };
}

async function readUploadedInvoice(file) {
  if (file.contentType !== "application/pdf") {
    try {
      const page = await imagePage(file.bytes);
      const base = interpretFinanceText(emptyPdfText(), file.bytes, file.fileName, "NOT_NEEDED");
      const ai = await requestDocumentAi(page, fetch, [page]);
      return applyAiPayload(base, ai);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(aiFailureMessage(error), "VALIDATION", 400);
    }
  }
  const text = await analyzeFinanceDocument(file.bytes, file.fileName);
  if (text.kind === "NOT_INVOICE" || text.kind === "STATEMENT" || invoiceReady(text)) return text;
  return analyzeFinanceDocument(file.bytes, file.fileName, { useVision: true });
}

function invoiceReady(reading) {
  return (reading.kind === "INVOICE" || reading.kind === "RECEIPT")
    && Boolean(reading.fields.vendor && reading.fields.number && reading.fields.issuedOn && reading.fields.amount && reading.fields.currency);
}

function emptyPdfText() {
  return {
    text: "",
    layer: "EMPTY" ,
    engine: "none" ,
    images: 1,
    contentStreams: 0,
    cmapEntries: 0,
    encrypted: false,
    pdfjs: "skipped" ,
  };
}

async function imagePage(bytes) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(bytes);
  const scale = Math.min(1, 2200 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return canvas.toBuffer("image/png");
}

function sameMoney(left, right) {
  return Number(left.toString()).toFixed(2) === Number(right).toFixed(2);
}

export async function buildInvoicePackage(actor, month) {
  assertCan(actor, "invoice:read");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new AppError("Dönem YYYY-AA formatında olmalı.", "VALIDATION", 400);
  }
  const invoices = await withDatabase((db) =>
    db.invoice.findMany({
      where: {
        issuedOn: { gte: dateOnly(`${month}-01`), lte: dateOnly(lastDay(month)) },
      },
      include: { document: true },
      orderBy: { number: "asc" },
    }),
  );
  const entries = [];
  const lines = ["faturaNo,tedarikci,tarih,tutar,paraBirimi,dosya"];
  for (const invoice of invoices) {
    const archive = planDriveArchive({
      issuedOn: toIsoDate(invoice.issuedOn),
      vendor: invoice.vendor,
      number: invoice.number,
    });
    const fileName = invoice.document ? `${archive.folder}/${archive.fileName}` : "";
    lines.push(
      [
        invoice.number,
        invoice.vendor,
        toIsoDate(invoice.issuedOn),
        invoice.amount.toString(),
        invoice.currency,
        fileName,
      ]
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(","),
    );
    if (invoice.document) {
      const bytes = await readFinanceFile(invoice.document.storageKey);
      entries.push({ name: fileName, bytes });
    }
  }
  entries.unshift({
    name: `Flywork/Faturalar/${month}/paket.csv`,
    bytes: Buffer.from(lines.join("\n"), "utf8"),
  });
  return { month, count: invoices.length, bytes: storeZip(entries) };
}

function invoiceZipName(fileName, used) {
  const leaf = (fileName.split(/[/\\]/).pop() ?? "").replace(/[\u0000-\u001f]/g, "").trim() || "fatura";
  const cleaned = leaf.slice(0, 140);
  const seen = used.get(cleaned) ?? 0;
  used.set(cleaned, seen + 1);
  if (seen === 0) {
    return cleaned;
  }
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) {
    return `${cleaned}-${seen + 1}`;
  }
  return `${cleaned.slice(0, dot)}-${seen + 1}${cleaned.slice(dot)}`;
}

export async function buildMonthInvoiceZip(actor, month, scope) {
  assertCan(actor, "invoice:read");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new AppError("Dönem YYYY-AA formatında olmalı.", "VALIDATION", 400);
  }
  const invoices = await withDatabase((db) =>
    db.invoice.findMany({
      where: {
        scope,
        issuedOn: { gte: dateOnly(`${month}-01`), lte: dateOnly(lastDay(month)) },
        document: { isNot: null },
      },
      include: { document: true },
      orderBy: [{ issuedOn: "asc" }, { number: "asc" }],
    }),
  );
  const used = new Map();
  const entries = [];
  for (const invoice of invoices) {
    if (!invoice.document) {
      continue;
    }
    try {
      const bytes = await readFinanceFile(invoice.document.storageKey);
      entries.push({ name: invoiceZipName(invoice.document.fileName, used), bytes });
    } catch {
      continue;
    }
  }
  if (entries.length === 0) {
    throw new AppError("Bu ayda indirilecek fatura dosyası yok.", "NOT_FOUND", 404);
  }
  return { month, count: entries.length, bytes: storeZip(entries) };
}

export async function openExpenseDocument(actor, documentId) {
  assertCan(actor, "expense:read:own");
  const document = await withDatabase((db) =>
    db.expenseDocument.findUnique({
      where: { id: documentId },
      include: { expense: { select: { userId: true } } },
    }),
  );
  if (!document) {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
  if (actor.role !== "ADMIN" && document.expense.userId !== actor.id) {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
  return {
    fileName: document.fileName,
    contentType: document.contentType,
    bytes: await readFinanceFile(document.storageKey),
  };
}

export async function openInvoiceDocument(actor, documentId) {
  assertCan(actor, "invoice:read");
  const document = await withDatabase((db) =>
    db.invoiceDocument.findUnique({ where: { id: documentId } }),
  );
  if (!document) {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
  return {
    fileName: document.fileName,
    contentType: document.contentType,
    bytes: await readFinanceFile(document.storageKey),
  };
}

export async function listSubscriptions(actor) {
  assertCan(actor, "subscription:read");
  const subscriptions = await withDatabase((db) =>
    db.technologySubscription.findMany({ orderBy: { renewsOn: "asc" } }),
  );
  return subscriptions.map((item) => ({
    id: item.id,
    name: item.name,
    vendor: item.vendor,
    kind: item.kind,
    amount: item.amount.toString(),
    currency: item.currency,
    billingCycle: item.billingCycle,
    renewsOn: toIsoDate(item.renewsOn),
    active: item.active,
  }));
}

export async function createSubscription(actor, input) {
  assertCan(actor, "subscription:write");
  const data = parseInput(subscriptionSchema, input);
  const subscription = await withDatabase((db) =>
    db.technologySubscription.create({
      data: {
        name: data.name,
        vendor: data.vendor,
        kind: data.kind,
        amount: data.amount,
        billingCycle: data.billingCycle,
        renewsOn: dateOnly(data.renewsOn),
        note: data.note,
      },
    }),
  );
  return {
    id: subscription.id,
    name: subscription.name,
    renewsOn: toIsoDate(subscription.renewsOn),
    amount: subscription.amount.toString(),
  };
}

 
