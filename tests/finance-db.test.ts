// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { removeFinanceFile } from "@/server/finance/documents";
import {
  buildInvoicePackage,
  createExpense,
  createInvoice,
  getExpensePage,
  getInvoicePage,
  markExpensePaid,
  openExpenseDocument,
  reviewExpense,
  updateExpense,
} from "@/server/services/finance";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds: string[] = [];

function fixtureEmail() {
  return `faz5-${randomUUID()}@example.invalid`;
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

const invoicePdf = Buffer.from(
  "%PDF-1.4\n(Fatura No: FW-100)\n(Tedarikci: Faz5 Ltd)\n(2026-10-21)\n(150.00 TRY)\n%%EOF",
);

describe.skipIf(!databaseReady)("harcama ve fatura veritabanı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const leftovers = await db.user.findMany({
      where: { email: { startsWith: "faz5-", endsWith: "@example.invalid" } },
      select: { id: true },
    });
    const userIds = [...new Set([...fixtureIds, ...leftovers.map((user) => user.id)])];
    const expenseDocs = await db.expenseDocument.findMany({
      where: { expense: { userId: { in: userIds } } },
      select: { storageKey: true },
    });
    const invoiceDocs = await db.invoiceDocument.findMany({
      where: { invoice: { vendorKey: { startsWith: "faz5" } } },
      select: { storageKey: true },
    });
    for (const document of [...expenseDocs, ...invoiceDocs]) {
      await removeFinanceFile(document.storageKey);
    }
    if (userIds.length > 0) {
      await db.expense.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await db.invoiceReview.deleteMany({
      where: { OR: [{ fileName: { startsWith: "faz5" } }, { vendor: { startsWith: "Faz5" } }] },
    });
    await db.invoice.deleteMany({ where: { vendorKey: { startsWith: "faz5" } } });
  });

  it("harcamayı onaylar, geri ödemeyi izler ve türleri ayrı sayar", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz5 Yonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz5 Calisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const otherRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz5 Diger ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id, otherRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const other: Actor = otherRow;

    const created = await createExpense(
      employee,
      {
        scope: "EMPLOYEE",
        category: "TRANSPORT",
        title: "Taksi",
        vendor: "Faz5 Ulasim",
        amount: "80.00",
        currency: "TRY",
        paymentMethod: "CASH",
        spentOn: "2026-10-21",
      },
      { bytes: invoicePdf, fileName: "fis.pdf", contentType: "application/pdf" },
    );
    await expectCode(
      () =>
        createExpense(employee, {
          scope: "COMPANY",
          category: "SOFTWARE",
          title: "Lisans",
          amount: "10.00",
          currency: "USD",
          paymentMethod: "CARD",
          spentOn: "2026-10-21",
        }),
      "FORBIDDEN",
    );
    const own = await getExpensePage(employee, "EMPLOYEE", { month: "2026-10", year: "2026" });
    const hidden = await getExpensePage(other, "EMPLOYEE", { month: "2026-10", year: "2026" });
    expect(own.expenses.map((expense) => expense.id)).toContain(created.id);
    expect(hidden.expenses.map((expense) => expense.id)).not.toContain(created.id);
    expect(own.monthReport.byCurrency).toEqual([]);

    const stored = await db.expenseDocument.findUnique({ where: { expenseId: created.id } });
    expect(stored).not.toBeNull();
    await expectCode(() => openExpenseDocument(other, stored!.id), "NOT_FOUND");
    const opened = await openExpenseDocument(employee, stored!.id);
    expect(opened.bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");

    await expectCode(() => markExpensePaid(admin, created.id), "CONFLICT");
    await reviewExpense(admin, created.id, { decision: "APPROVED" });
    const approved = await getExpensePage(admin, "EMPLOYEE", {
      userId: employee.id,
      category: "TRANSPORT",
      status: "APPROVED",
      from: "2026-10-01",
      to: "2026-10-31",
      month: "2026-10",
      year: "2026",
    });
    expect(approved.expenses).toHaveLength(1);
    expect(approved.expenses[0]?.reimbursement).toBe("PENDING");
    expect(approved.monthReport.byCurrency).toEqual([{ currency: "TRY", total: "80.00", count: 1 }]);
    expect(approved.monthReport.byCategory).toEqual([{ category: "TRANSPORT", currency: "TRY", total: "80.00", count: 1 }]);
    expect(approved.pendingReport).toEqual([{ currency: "TRY", total: "80.00", count: 1 }]);
    await expectCode(
      () => updateExpense(other, created.id, {
        category: "TRANSPORT",
        title: "Taksi",
        amount: "80.00",
        currency: "TRY",
        paymentMethod: "CASH",
        spentOn: "2026-10-21",
      }),
      "NOT_FOUND",
    );
    await expectCode(
      () => updateExpense(employee, created.id, {
        category: "TRANSPORT",
        title: "Taksi",
        amount: "90.00",
        currency: "TRY",
        paymentMethod: "CASH",
        spentOn: "2026-10-21",
      }),
      "FORBIDDEN",
    );
    expect((await db.expense.findUnique({ where: { id: created.id } }))?.amount.toString()).toBe("80");
    await updateExpense(employee, created.id, {
      category: "TRANSPORT",
      title: "Taksi notu",
      vendor: "Faz5 Ulasim",
      amount: "80.00",
      currency: "TRY",
      paymentMethod: "CASH",
      spentOn: "2026-10-21",
    });
    await updateExpense(admin, created.id, {
      category: "TRANSPORT",
      title: "Taksi notu",
      amount: "90.00",
      currency: "TRY",
      paymentMethod: "CASH",
      spentOn: "2026-10-21",
    });
    expect((await db.expense.findUnique({ where: { id: created.id } }))?.amount.toString()).toBe("90");
    await markExpensePaid(admin, created.id);
    const paid = await db.expense.findUnique({ where: { id: created.id } });
    expect(paid?.status).toBe("PAID");
    expect(paid?.reimbursement).toBe("PAID");

    const rejected = await createExpense(employee, {
      scope: "EMPLOYEE",
      category: "MEAL",
      title: "Yemek",
      amount: "20.00",
      currency: "TRY",
      paymentMethod: "CARD",
      spentOn: "2026-10-22",
    });
    await expectCode(() => reviewExpense(admin, rejected.id, { decision: "REJECTED", reviewNote: "x" }), "VALIDATION");
    await reviewExpense(admin, rejected.id, { decision: "REJECTED", reviewNote: "Belge yok" });
    await expectCode(() => markExpensePaid(admin, rejected.id), "CONFLICT");

    await createExpense(admin, {
      scope: "COMPANY",
      category: "SOFTWARE",
      title: "Lisans",
      vendor: "Faz5 Yazilim",
      amount: "30.00",
      currency: "USD",
      paymentMethod: "CARD",
      accountLabel: "Sirket karti",
      spentOn: "2026-10-21",
    });
    await createExpense(admin, {
      scope: "OFFICE",
      category: "RENT",
      title: "Kira",
      vendor: "Faz5 Ofis",
      amount: "1000.00",
      currency: "TRY",
      paymentMethod: "TRANSFER",
      spentOn: "2026-10-21",
    });
    await expectCode(
      () =>
        createExpense(admin, {
          scope: "OFFICE",
          category: "SOFTWARE",
          title: "Yanlis kategori",
          amount: "1.00",
          currency: "TRY",
          paymentMethod: "CASH",
          spentOn: "2026-10-21",
        }),
      "VALIDATION",
    );
    const company = await getExpensePage(admin, "COMPANY", { month: "2026-10", year: "2026" });
    const office = await getExpensePage(admin, "OFFICE", { month: "2026-10", year: "2026" });
    expect(company.monthReport.byCurrency).toEqual([{ currency: "USD", total: "30.00", count: 1 }]);
    expect(office.monthReport.byCurrency).toEqual([{ currency: "TRY", total: "1000.00", count: 1 }]);
    expect(company.scopeReport).toEqual(expect.arrayContaining([
      { scope: "COMPANY", currency: "USD", total: "30.00", count: 1 },
      { scope: "OFFICE", currency: "TRY", total: "1000.00", count: 1 },
    ]));
    const onlyUsd = await getExpensePage(admin, "COMPANY", { month: "2026-10", year: "2026", currency: "USD" });
    const onlyTry = await getExpensePage(admin, "COMPANY", { month: "2026-10", year: "2026", currency: "TRY" });
    expect(onlyUsd.expenses).toHaveLength(1);
    expect(onlyTry.expenses).toHaveLength(0);
    expect(onlyUsd.monthReport.byCurrency.some((row) => row.currency === "TRY")).toBe(false);
    expect(company.monthReport.byPayment[0]?.paymentMethod).toBe("CARD");
    expect(office.expenses.some((expense) => expense.title === "Lisans")).toBe(false);
  });

  it("faturayı harcamaya bir kez bağlar ve mükerreri engeller", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz5 Fatura ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz5 Personel ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const number = `FW-${randomUUID().slice(0, 8)}`;

    const expense = await createExpense(admin, {
      scope: "COMPANY",
      category: "SERVICE",
      title: "Bakim",
      vendor: "Faz5 Servis",
      amount: "150.00",
      currency: "TRY",
      paymentMethod: "TRANSFER",
      spentOn: "2026-10-21",
    });
    await expectCode(
      () =>
        createInvoice(admin, {
          number,
          vendor: "Faz5 Servis",
          scope: "COMPANY",
          category: "SERVICE",
          amount: "150.00",
          currency: "TRY",
          paymentMethod: "TRANSFER",
          issuedOn: "2026-10-21",
          expenseId: expense.id,
          createExpense: false,
        }, { bytes: Buffer.from("%PDF-1.4\n(Proforma teklif)\n%%EOF"), fileName: "teklif.pdf", contentType: "application/pdf" }),
      "VALIDATION",
    );
    const invoice = await createInvoice(
      admin,
      {
        number,
        vendor: "  Faz5   Servis ",
        scope: "COMPANY",
        category: "SERVICE",
        amount: "150.00",
        currency: "TRY",
        paymentMethod: "TRANSFER",
        issuedOn: "2026-10-21",
        expenseId: expense.id,
        createExpense: false,
      },
      { bytes: invoicePdf, fileName: "fatura.pdf", contentType: "application/pdf" },
    );
    expect(invoice.warning).toBeTruthy();
    const page = await getExpensePage(admin, "COMPANY", { month: "2026-10", year: "2026" });
    const row = page.expenses.find((item) => item.id === expense.id);
    expect(row?.invoice?.number).toBe(number);
    expect(page.monthReport.byCurrency.find((item) => item.currency === "TRY")?.total).toBe("150.00");

    await expectCode(
      () =>
        createInvoice(admin, {
          number,
          vendor: "faz5 servis",
          scope: "COMPANY",
          category: "SERVICE",
          amount: "150.00",
          currency: "TRY",
          paymentMethod: "TRANSFER",
          issuedOn: "2026-10-21",
          createExpense: false,
        }),
      "CONFLICT",
    );
    await expectCode(
      () => createInvoice(admin, {
        number: `${number}-yeni`,
        vendor: "Faz5 Yeni",
        scope: "COMPANY",
        category: "SERVICE",
        amount: "10.00",
        currency: "TRY",
        paymentMethod: "CASH",
        issuedOn: "2026-10-21",
        createExpense: true,
      }),
      "VALIDATION",
    );
    const officeExpense = await createExpense(admin, {
      scope: "OFFICE",
      category: "CLEANING",
      title: "Temizlik",
      vendor: "Faz5 Baska",
      amount: "40.00",
      currency: "EUR",
      paymentMethod: "CASH",
      spentOn: "2026-10-21",
    });
    const otherNumber = await createInvoice(admin, {
      number,
      vendor: "Faz5 Baska",
      scope: "OFFICE",
      category: "CLEANING",
      amount: "40.00",
      currency: "EUR",
      paymentMethod: "CASH",
      issuedOn: "2026-10-21",
      expenseId: officeExpense.id,
      createExpense: false,
    });
    const office = await getExpensePage(admin, "OFFICE", { month: "2026-10", year: "2026" });
    expect(office.monthReport.byCurrency).toContainEqual({ currency: "EUR", total: "40.00", count: 1 });
    expect(office.expenses.some((item) => item.invoice?.id === otherNumber.id)).toBe(true);

    const invoices = await getInvoicePage(admin, "2026-10");
    expect(typeof invoices.google.connected).toBe("boolean");
    expect(invoices.invoices.some((item) => item.id === invoice.id)).toBe(true);
    await expectCode(() => getInvoicePage(employee, "2026-10"), "FORBIDDEN");
    const pack = await buildInvoicePackage(admin, "2026-10");
    expect(pack.count).toBeGreaterThanOrEqual(2);
    expect(pack.bytes.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("onaylı faturayı bir kez bağlar, farkı onaylatır ve denetler", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz5 Denetim ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz5 Kayit ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const pan = "4242424242424242";
    const created = await createExpense(employee, {
      scope: "EMPLOYEE",
      category: "SUPPLIES",
      title: "Kirtasiye",
      amount: "15.00",
      currency: "TRY",
      paymentMethod: "CARD",
      accountLabel: pan,
      spentOn: "2026-10-22",
    });
    const stored = await db.expense.findUnique({ where: { id: created.id } });
    expect(stored?.accountLabel).toBe("4242");
    const createAudit = await db.expenseAudit.findFirst({ where: { expenseId: created.id, action: "CREATE" } });
    expect(JSON.stringify(createAudit?.changes)).not.toContain(pan);

    const company = await createExpense(admin, {
      scope: "COMPANY",
      category: "SERVICE",
      title: "Bakim bag",
      vendor: "Faz5 Bag",
      amount: "80.00",
      currency: "TRY",
      paymentMethod: "TRANSFER",
      spentOn: "2026-10-22",
    });
    const number = `FW-${randomUUID().slice(0, 8)}`;
    const invoice = await createInvoice(admin, {
      number,
      vendor: "Faz5 Bag",
      scope: "COMPANY",
      category: "SERVICE",
      amount: "150.00",
      currency: "TRY",
      paymentMethod: "TRANSFER",
      issuedOn: "2026-10-22",
      createExpense: false,
    });
    const beforeInvoice = await db.invoice.findUnique({ where: { id: invoice.id } });
    await db.invoiceReview.create({
      data: {
        status: "APPROVED",
        archived: true,
        contentHash: randomBytes(16).toString("hex"),
        storageKey: randomBytes(16).toString("hex"),
        fileName: `faz5-${number}.pdf`,
        sizeBytes: 12,
        vendor: "Faz5 Bag",
        number,
        amount: "150.00",
        currency: "TRY",
        documentType: "INVOICE",
        aiSnapshot: {},
        invoiceId: invoice.id,
      },
    });
    const fields = {
      category: "SERVICE" as const,
      title: "Bakim bag",
      vendor: "Faz5 Bag",
      amount: "80.00",
      currency: "TRY" as const,
      paymentMethod: "TRANSFER" as const,
      spentOn: "2026-10-22",
      invoiceId: invoice.id,
    };
    await expectCode(() => updateExpense(admin, company.id, fields), "VALIDATION");
    await updateExpense(admin, company.id, { ...fields, acceptAmountDifference: true });
    const linked = await db.expense.findUnique({ where: { id: company.id } });
    const afterInvoice = await db.invoice.findUnique({ where: { id: invoice.id } });
    const review = await db.invoiceReview.findFirst({ where: { invoiceId: invoice.id } });
    expect(linked?.invoiceId).toBe(invoice.id);
    expect(linked?.status).toBe("APPROVED");
    expect(afterInvoice?.status).toBe(beforeInvoice?.status);
    expect(afterInvoice?.amount.toString()).toBe(beforeInvoice?.amount.toString());
    expect(review?.archived).toBe(true);
    expect(review?.driveFileId).toBeNull();
    await expectCode(
      () => createExpense(admin, {
        scope: "COMPANY",
        category: "SERVICE",
        title: "Ikinci",
        vendor: "Faz5 Bag",
        amount: "150.00",
        currency: "TRY",
        paymentMethod: "TRANSFER",
        spentOn: "2026-10-22",
        invoiceId: invoice.id,
      }),
      "CONFLICT",
    );
    const actions = await db.expenseAudit.findMany({
      where: { expenseId: company.id },
      select: { action: true },
    });
    expect(actions.map((item) => item.action)).toEqual(expect.arrayContaining(["CREATE", "LINK_INVOICE"]));
    expect(await db.expense.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });
});
