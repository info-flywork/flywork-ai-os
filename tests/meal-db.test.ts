// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createInitialAdmin } from "@/server/auth/bootstrap";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { dateOnly } from "@/server/dates";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { addIsoDays, istanbulClock, upcomingMealDates } from "@/server/meals/schedule";
import { loadMealCloseNotice } from "@/server/telegram/notices";
import {
  getAdminMealView,
  getEmployeeMealView,
  getMealSchedule,
  getMealSpendReport,
  listMealCatalog,
  listOwnMealOrders,
  prepareMealReminder,
  publishCatalogMenu,
  saveGuestMealOrder,
  saveManagedMealOrder,
  saveMealDish,
  saveMealMenu,
  saveOwnMealOrder,
  updateClosingTime,
  updateMealOrderStatus,
} from "@/server/services/meals";
import { createUser, listUsers, setUserActive } from "@/server/services/users";
import type { Actor } from "@/server/auth/permissions";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds: string[] = [];
const fixtureMenuIds: string[] = [];

function fixtureEmail() {
  return `faz3-${randomUUID()}@example.invalid`;
}

function fixturePassword() {
  return `Test-${randomBytes(6).toString("hex")}!a1`;
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

async function unusedMealDate() {
  const db = getPrisma();
  let date = "2099-01-04";
  for (let step = 0; step < 28; step += 1) {
    const clock = istanbulClock(new Date(`${date}T12:00:00+03:00`));
    if (clock.weekday === 1 || clock.weekday === 2 || clock.weekday === 4) {
      const existing = await db.mealMenu.findUnique({ where: { date: dateOnly(date) } });
      if (!existing) {
        return date;
      }
    }
    date = addIsoDays(date, 1);
  }
  throw new Error("Uygun test günü bulunamadı.");
}

describe.skipIf(!databaseReady)("yemek ve hesap veritabanı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const leftovers = await db.user.findMany({
      where: { email: { startsWith: "faz3-", endsWith: "@example.invalid" } },
      select: { id: true },
    });
    const userIds = [...new Set([...fixtureIds, ...leftovers.map((user) => user.id)])];
    if (fixtureMenuIds.length > 0 || userIds.length > 0) {
      await db.mealOrderAudit.deleteMany({
        where: {
          OR: [
            { actorId: { in: userIds } },
            { subjectUserId: { in: userIds } },
          ],
        },
      });
      await db.mealGuestOrder.deleteMany({
        where: {
          OR: [
            { menuId: { in: fixtureMenuIds } },
            { createdById: { in: userIds } },
          ],
        },
      });
      await db.mealOrder.deleteMany({
        where: {
          OR: [
            { menuId: { in: fixtureMenuIds } },
            { userId: { in: userIds } },
          ],
        },
      });
    }
    if (fixtureMenuIds.length > 0) {
      await db.mealMenuItem.deleteMany({ where: { menuId: { in: fixtureMenuIds } } });
      await db.mealMenu.deleteMany({ where: { id: { in: fixtureMenuIds } } });
    }
    if (userIds.length > 0) {
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await db.mealDish.deleteMany({ where: { name: { startsWith: "Faz3 " } } });
    await db.$disconnect();
  });

  it("ilk yönetici yoksa oluşturur, varsa reddeder ve şifreyi düz metin saklamaz", async () => {
    const db = getPrisma();
    const password = fixturePassword();
    const existingAdmins = await db.user.count({ where: { role: "ADMIN" } });

    let createdId: string | null = null;
    try {
      if (existingAdmins === 0) {
        const email = fixtureEmail();
        const created = await createInitialAdmin(db, {
          name: "Faz3 Yonetici",
          email,
          password,
        });
        const row = await db.user.findUnique({
          where: { email: created.email },
          select: { id: true, passwordHash: true },
        });
        createdId = row!.id;
        fixtureIds.push(createdId);
        expect(row?.passwordHash.startsWith("scrypt$")).toBe(true);
        expect(row?.passwordHash.includes(password)).toBe(false);
        expect(await verifyPassword(password, row!.passwordHash)).toBe(true);
      }

      await expectCode(
        () =>
          createInitialAdmin(db, {
            name: "Faz3 Yonetici",
            email: fixtureEmail(),
            password,
          }),
        "CONFLICT",
      );
    } finally {
      if (createdId) {
        await db.user.delete({ where: { id: createdId } });
      }
    }
  });

  it("aynı gün tek sipariş tutar, kapanıştan sonra reddeder ve çalışanları ayırır", async () => {
    const db = getPrisma();
    const password = fixturePassword();
    const passwordHash = await hashPassword(password);
    const date = await unusedMealDate();
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 Yonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 Calisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const otherRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 Diger ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id, otherRow.id);

    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const other: Actor = otherRow;
    const menu = await saveMealMenu(admin, {
      date,
      published: true,
      items: [{ name: "Corba" }, { name: "Tavuk" }],
    });
    fixtureMenuIds.push(menu.id);
    const morning = new Date(`${date}T08:00:00+03:00`);
    const first = await saveOwnMealOrder(
      employee,
      { menuId: menu.id, itemId: menu.items[0].id },
      morning,
    );
    const second = await saveOwnMealOrder(
      employee,
      { menuId: menu.id, itemId: menu.items[1].id },
      new Date(`${date}T09:00:00+03:00`),
    );
    const otherOrder = await saveOwnMealOrder(
      other,
      { menuId: menu.id, itemId: menu.items[0].id },
      morning,
    );

    expect(first.changed).toBe(false);
    expect(second.changed).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await db.mealOrder.count({ where: { userId: employee.id, menuId: menu.id } })).toBe(1);

    await expectCode(
      () =>
        saveOwnMealOrder(
          employee,
          { menuId: menu.id, itemId: menu.items[0].id },
          new Date(`${date}T10:31:00+03:00`),
        ),
      "FORBIDDEN",
    );

    let closedDay = addIsoDays(date, 1);
    while (
      [1, 2, 4].includes(istanbulClock(new Date(`${closedDay}T12:00:00+03:00`)).weekday)
    ) {
      closedDay = addIsoDays(closedDay, 1);
    }
    await expectCode(
      () =>
        saveMealMenu(admin, {
          date: closedDay,
          published: true,
          items: [{ name: "Yemek" }],
        }),
      "VALIDATION",
    );
    await expectCode(
      () =>
        saveOwnMealOrder(
          employee,
          { menuId: menu.id, itemId: menu.items[0].id },
          new Date(`${closedDay}T09:00:00+03:00`),
        ),
      "FORBIDDEN",
    );

    const ownOrders = await listOwnMealOrders(employee);
    expect(ownOrders.map((order) => order.id)).toEqual([first.id]);
    expect(JSON.stringify(ownOrders)).not.toContain(other.name);

    const employeeView = await getEmployeeMealView(employee, morning);
    expect(employeeView.ownOrder?.itemId).toBe(menu.items[1].id);
    expect(JSON.stringify(employeeView)).not.toContain(other.name);

    await expectCode(() => getAdminMealView(employee, date, "day", morning), "FORBIDDEN");
    await expectCode(() => listUsers(employee), "FORBIDDEN");
    await expectCode(() => setUserActive(admin, admin.id, false), "FORBIDDEN");

    const adminView = await getAdminMealView(admin, date, "day", morning);
    expect(adminView.orders.map((order) => order.employeeName).sort()).toEqual(
      [employee.name, other.name].sort(),
    );
    expect(adminView.catererSummary).toHaveLength(2);
    expect(adminView.catererSummary).toEqual(
      expect.arrayContaining([
        { name: "Tavuk", count: 1 },
        { name: "Corba", count: 1 },
      ]),
    );
    expect(adminView.catererText).toContain("Tavuk: 1");
    expect(adminView.catererText).toContain("Corba: 1");
    expect(adminView.catererText).toContain("Toplam: 2");

    await updateMealOrderStatus(admin, otherOrder.id, { status: "CANCELLED" });
    const afterCancel = await getAdminMealView(admin, date, "week", morning);
    expect(afterCancel.catererSummary).toEqual([{ name: "Tavuk", count: 1 }]);
    expect(afterCancel.catererText).toContain("Tavuk: 1");
    expect(afterCancel.catererText).toContain("Toplam: 1");
    expect(afterCancel.catererText).not.toContain("Corba");
    expect(afterCancel.report.total).toBe(1);
    expect(afterCancel.report.byEmployee.map((row) => row.name)).toEqual([employee.name]);

    const monthView = await getAdminMealView(admin, date, "month", morning);
    expect(monthView.range.from.endsWith("-01")).toBe(true);
    expect(monthView.report.total).toBe(1);
    expect(monthView.catererSummary).toEqual([{ name: "Tavuk", count: 1 }]);

    const accountPassword = fixturePassword();
    const account = await createUser(admin, {
      name: `Faz3 Hesap ${randomUUID().slice(0, 8)}`,
      email: fixtureEmail(),
      password: accountPassword,
      role: "EMPLOYEE",
    });
    fixtureIds.push(account.id);
    expect(account).not.toHaveProperty("passwordHash");
    expect(account.role).toBe("EMPLOYEE");
    await setUserActive(admin, account.id, false);
    const disabled = await db.user.findUnique({
      where: { id: account.id },
      select: { active: true },
    });
    expect(disabled?.active).toBe(false);

    const originalClose = (await getMealSchedule(admin)).closesAt;
    try {
      const updated = await updateClosingTime(admin, { closesAt: "11:00" });
      expect(updated.closesAt).toBe("11:00");
      await expectCode(() => updateClosingTime(employee, { closesAt: "11:15" }), "FORBIDDEN");
    } finally {
      await updateClosingTime(admin, { closesAt: originalClose });
    }

    const outsiders = await db.user.count({
      where: { role: "ADMIN", active: true, id: { notIn: fixtureIds } },
    });
    if (outsiders === 0) {
      const secondAdmin = await db.user.create({
        data: {
          email: fixtureEmail(),
          name: `Faz3 Ikinci ${randomUUID().slice(0, 8)}`,
          role: "ADMIN",
          passwordHash,
        },
        select: { id: true },
      });
      fixtureIds.push(secondAdmin.id);
      await setUserActive(admin, secondAdmin.id, false);
      await expectCode(() => setUserActive({ ...adminRow, id: secondAdmin.id, role: "ADMIN", email: "", name: "" }, admin.id, false), "CONFLICT");
      await setUserActive(admin, secondAdmin.id, true);
    }
  });

  it("katalog menüsünde gelecek gün, üç seçim, ofiste olmama ve tek kayıt kuralını uygular", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(fixturePassword());
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 Katalog ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 KatalogCalisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const anchor = await unusedMealDate();
    const target = upcomingMealDates(anchor, [1, 2, 4], 6).find((date) => date > anchor);
    if (!target) {
      throw new Error("Ön sipariş günü bulunamadı.");
    }
    const morning = new Date(`${anchor}T09:00:00+03:00`);
    const main = await saveMealDish(adminRow, {
      name: "Faz3 Ana",
      categoryId: "cat-tavuklu",
      slot: "MAIN",
      active: true,
    });
    const soup = await saveMealDish(adminRow, {
      name: "Faz3 Corba",
      categoryId: "cat-yan",
      slot: "SOUP",
      active: true,
    });
    const side = await saveMealDish(adminRow, {
      name: "Faz3 Pilav",
      categoryId: "cat-pilav",
      slot: "SIDE",
      active: true,
    });
    const published = await publishCatalogMenu(adminRow, {
      date: target,
      published: true,
      dishIds: [main.id, soup.id, side.id],
    });
    fixtureMenuIds.push(published.id);
    const menu = await db.mealMenu.findUniqueOrThrow({
      where: { id: published.id },
      include: { items: true },
    });
    const ids = {
      mainItemId: menu.items.find((item) => item.slot === "MAIN")?.id,
      soupItemId: menu.items.find((item) => item.slot === "SOUP")?.id,
      sideItemId: menu.items.find((item) => item.slot === "SIDE")?.id,
    };

    await expectCode(
      () => saveOwnMealOrder(employeeRow, { menuId: menu.id, mainItemId: ids.mainItemId }, morning),
      "VALIDATION",
    );
    await expectCode(
      () =>
        saveOwnMealOrder(
          employeeRow,
          { menuId: menu.id, mainItemId: ids.mainItemId, soupItemId: ids.mainItemId, sideItemId: ids.sideItemId },
          morning,
        ),
      "VALIDATION",
    );

    const created = await saveOwnMealOrder(employeeRow, { menuId: menu.id, ...ids, note: "az acı" }, morning);
    const updated = await saveOwnMealOrder(employeeRow, { menuId: menu.id, ...ids, note: "not güncellendi" }, morning);
    expect(created.changed).toBe(false);
    expect(updated.id).toBe(created.id);
    expect(updated.changed).toBe(true);
    expect(await db.mealOrder.count({ where: { userId: employeeRow.id, menuId: menu.id } })).toBe(1);
    await expect(
      db.mealOrder.create({
        data: { userId: employeeRow.id, menuId: menu.id, itemId: ids.mainItemId },
      }),
    ).rejects.toThrow();

    const away = await saveOwnMealOrder(employeeRow, { menuId: menu.id, absent: true, note: "izinliyim" }, morning);
    expect(away.id).toBe(created.id);
    expect(away.absent).toBe(true);
    expect(away.itemId).toBeNull();

    const adminView = await getAdminMealView(adminRow, target, "day", morning);
    expect(adminView.absentCount).toBe(1);
    expect(adminView.slotSummary.main).toEqual([]);
    expect(adminView.catererText).toContain("Ofiste olmayan: 1");
    expect(adminView.catererText).not.toMatch(/gönderildi|telegram/i);
    expect(adminView.orders[0]?.note).toBe("izinliyim");

    const notice = await loadMealCloseNotice(db, target);
    expect(notice.text).toContain("Ofiste olmayan: 1");
    expect(notice.text).not.toMatch(/gönderildi|token/i);

    await expectCode(
      () => saveOwnMealOrder(employeeRow, { menuId: menu.id, ...ids }, new Date(`${target}T10:31:00+03:00`)),
      "FORBIDDEN",
    );
    let distantDate = addIsoDays(anchor, 28);
    for (let step = 0; step < 14; step += 1) {
      const weekday = istanbulClock(new Date(`${distantDate}T12:00:00+03:00`)).weekday;
      const existing = await db.mealMenu.findUnique({ where: { date: dateOnly(distantDate) } });
      if ([1, 2, 4].includes(weekday) && !existing) {
        break;
      }
      distantDate = addIsoDays(distantDate, 1);
    }
    const distant = await saveMealMenu(adminRow, {
      date: distantDate,
      published: true,
      items: [{ name: "Faz3 Uzak" }],
    });
    fixtureMenuIds.push(distant.id);
    await expectCode(
      () => saveOwnMealOrder(employeeRow, { menuId: distant.id, itemId: distant.items[0].id }, morning),
      "FORBIDDEN",
    );
    await expectCode(
      () => saveMealDish(employeeRow, { name: "Faz3 Yasak", categoryId: "cat-tatli", slot: "MAIN", active: true }),
      "FORBIDDEN",
    );
  });

  it("yayındaki menüyü kapanışa kadar değiştirir ve eski seçimi başka yemeğe taşımaz", async () => {
    const db = getPrisma();
    const beforeDishes = await db.mealDish.count({ where: { NOT: { name: { startsWith: "Faz3" } } } });
    const beforeOrders = await db.mealOrder.count({
      where: { user: { email: { not: { endsWith: "@example.invalid" } } } },
    });
    const passwordHash = await hashPassword(fixturePassword());
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 PlanYonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 PlanCalisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const date = await unusedMealDate();
    const open = new Date(`${date}T09:00:00+03:00`);
    const schedule = await getMealSchedule(adminRow);
    const [closeHour, closeMinute] = schedule.closesAt.split(":").map(Number);
    const closedMinutes = closeHour * 60 + closeMinute + 1;
    const closed = new Date(
      `${date}T${String(Math.floor(closedMinutes / 60)).padStart(2, "0")}:${String(closedMinutes % 60).padStart(2, "0")}:00+03:00`,
    );
    const main = await saveMealDish(adminRow, { name: "Faz3 Plan Ana", categoryId: "cat-etli", slot: "MAIN", active: true });
    const replacement = await saveMealDish(adminRow, { name: "Faz3 Plan Ana2", categoryId: "cat-etli", slot: "MAIN", active: true });
    const soup = await saveMealDish(adminRow, { name: "Faz3 Plan Corba", categoryId: "cat-yan", slot: "SOUP", active: true });
    const side = await saveMealDish(adminRow, { name: "Faz3 Plan Pilav", categoryId: "cat-pilav", slot: "SIDE", active: true });
    const dishIds = [main.id, soup.id, side.id];

    await expectCode(
      () => publishCatalogMenu(employeeRow, { date, published: false, dishIds }),
      "FORBIDDEN",
    );
    await expectCode(
      () => publishCatalogMenu(adminRow, { date, published: true, dishIds }, closed),
      "FORBIDDEN",
    );

    const draft = await publishCatalogMenu(adminRow, { date, published: false, dishIds, note: "taslak" }, open);
    fixtureMenuIds.push(draft.id);
    expect(draft.published).toBe(false);
    expect(draft.conflicts).toEqual([]);
    const hidden = await getEmployeeMealView(employeeRow, open);
    expect(hidden.days.find((day) => day.date === date)?.menu).toBeNull();

    const published = await publishCatalogMenu(adminRow, { date, published: true, dishIds }, open);
    expect(published.id).toBe(draft.id);
    expect(published.published).toBe(true);
    const menu = await db.mealMenu.findUniqueOrThrow({ where: { id: draft.id }, include: { items: true } });
    const ids = {
      mainItemId: menu.items.find((item) => item.dishId === main.id)?.id ?? "",
      soupItemId: menu.items.find((item) => item.dishId === soup.id)?.id ?? "",
      sideItemId: menu.items.find((item) => item.dishId === side.id)?.id ?? "",
    };
    expect(ids.mainItemId).not.toBe("");
    const order = await saveOwnMealOrder(employeeRow, { menuId: menu.id, ...ids, note: "az acı" }, open);
    const revised = await publishCatalogMenu(
      adminRow,
      { date, published: true, dishIds: [replacement.id, soup.id, side.id] },
      open,
    );
    expect(revised.conflicts).toEqual([
      expect.objectContaining({ employeeName: employeeRow.name, itemName: "Faz3 Plan Ana", slotLabel: "Ana yemek" }),
    ]);
    const kept = await db.mealOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(kept.itemId).toBe(ids.mainItemId);
    expect(kept.itemId).not.toBe(menu.items.find((item) => item.dishId === replacement.id)?.id ?? "yeni");
    const oldItem = await db.mealMenuItem.findUniqueOrThrow({ where: { id: ids.mainItemId } });
    const added = await db.mealMenuItem.findFirstOrThrow({ where: { menuId: menu.id, dishId: replacement.id } });
    expect(oldItem.available).toBe(false);
    expect(added.available).toBe(true);
    await expectCode(
      () => saveOwnMealOrder(employeeRow, { menuId: menu.id, ...ids }, open),
      "VALIDATION",
    );
    await expectCode(
      () => publishCatalogMenu(adminRow, { date, published: true, dishIds }, closed),
      "FORBIDDEN",
    );
    const still = await db.mealOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(still.itemId).toBe(ids.mainItemId);
    await expectCode(
      () => saveMealMenu(adminRow, { date, published: true, items: [{ name: "Faz3 Serbest" }] }),
      "CONFLICT",
    );
    const adminView = await getAdminMealView(adminRow, date, "day", open);
    expect(adminView.invalidSelections).toEqual([
      expect.objectContaining({ employeeName: employeeRow.name, itemName: "Faz3 Plan Ana" }),
    ]);
    expect(adminView.slotSummary.main.map((row) => row.name)).not.toContain("Faz3 Plan Ana");
    expect(adminView.catererText).toContain("Faz3 Plan Ana menüden çıkarıldı");
    expect(adminView.catererText).toContain("az acı");
    expect(adminView.catererText).not.toMatch(/gönderildi|telegram|http/i);
    expect(await db.mealDish.count({ where: { NOT: { name: { startsWith: "Faz3" } } } })).toBe(beforeDishes);
    expect(await db.mealOrder.count({ where: { user: { email: { not: { endsWith: "@example.invalid" } } } } })).toBe(beforeOrders);
  });

  it("fiyatı çalışandan gizler, gideri yetkisiz kapatır ve eksik fiyatı sıfır saymaz", async () => {
    const db = getPrisma();
    const beforeDishes = await db.mealDish.count({ where: { NOT: { name: { startsWith: "Faz3" } } } });
    const passwordHash = await hashPassword(fixturePassword());
    const adminRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz3 Fiyat Yonetici", role: "ADMIN", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz3 Fiyat Calisan", role: "EMPLOYEE", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    const pendingRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz3 Fiyat Bekleyen", role: "EMPLOYEE", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id, pendingRow.id);
    const date = await unusedMealDate();
    const open = new Date(`${date}T09:00:00+03:00`);
    const main = await saveMealDish(adminRow, { name: "Faz3 Fiyat Ana", categoryId: "cat-etli", slot: "MAIN", active: true, price: "10,00" });
    const soup = await saveMealDish(adminRow, { name: "Faz3 Fiyat Corba", categoryId: "cat-yan", slot: "SOUP", active: true });
    const side = await saveMealDish(adminRow, { name: "Faz3 Fiyat Pilav", categoryId: "cat-pilav", slot: "SIDE", active: true, price: "5,00" });
    const published = await publishCatalogMenu(adminRow, { date, published: true, dishIds: [main.id, soup.id, side.id] }, open);
    fixtureMenuIds.push(published.id);
    const menu = await db.mealMenu.findUniqueOrThrow({ where: { id: published.id }, include: { items: true } });
    const ids = {
      mainItemId: menu.items.find((item) => item.slot === "MAIN")?.id ?? "",
      soupItemId: menu.items.find((item) => item.slot === "SOUP")?.id ?? "",
      sideItemId: menu.items.find((item) => item.slot === "SIDE")?.id ?? "",
    };

    const priceKeys = (value: unknown): string[] => {
      if (!value || typeof value !== "object") {
        return [];
      }
      return Object.entries(value).flatMap(([key, child]) => [
        ...(/price|cost|spend|amount|gider|fiyat/i.test(key) ? [key] : []),
        ...priceKeys(child),
      ]);
    };
    const employeeView = await getEmployeeMealView(employeeRow, open);
    const employeeCatalog = await listMealCatalog(employeeRow);
    expect(priceKeys(employeeView)).toEqual([]);
    expect(priceKeys(employeeCatalog)).toEqual([]);
    expect(JSON.stringify(employeeCatalog)).toContain("Faz3 Fiyat Ana");
    await expectCode(() => getMealSpendReport(employeeRow, 2099), "FORBIDDEN");
    await expectCode(() => saveManagedMealOrder(employeeRow, { userId: pendingRow.id, menuId: menu.id, ...ids }, open), "FORBIDDEN");
    await expectCode(() => prepareMealReminder(employeeRow, { userId: pendingRow.id, menuId: menu.id }, open), "FORBIDDEN");

    const adminCatalog = await listMealCatalog(adminRow);
    expect(adminCatalog.flatMap((category) => category.dishes).find((dish) => dish.name === "Faz3 Fiyat Ana")?.priceLabel).toBe("10,00 TL");

    const created = await saveManagedMealOrder(adminRow, { userId: employeeRow.id, menuId: menu.id, ...ids, note: "ilk" }, open);
    const updated = await saveManagedMealOrder(adminRow, { userId: employeeRow.id, menuId: menu.id, ...ids, note: "guncel" }, open);
    expect(updated.id).toBe(created.id);
    expect(updated.changed).toBe(true);
    expect(await db.mealOrder.count({ where: { userId: employeeRow.id, menuId: menu.id } })).toBe(1);
    expect(await db.mealOrderAudit.count({ where: { orderId: created.id, actorId: adminRow.id } })).toBe(2);

    await saveOwnMealOrder(employeeRow, { menuId: menu.id, absent: true, note: "disarida" }, open);
    const adminView = await getAdminMealView(adminRow, date, "day", open);
    expect(adminView.away.map((person) => person.id)).toContain(employeeRow.id);
    expect(adminView.pending.map((person) => person.id)).toContain(pendingRow.id);
    expect(adminView.pending.map((person) => person.id)).not.toContain(employeeRow.id);

    const guest = await saveGuestMealOrder(adminRow, { menuId: menu.id, guestName: "Faz3 Misafir", ...ids }, open);
    expect(guest.changed).toBe(false);
    expect(await db.mealGuestOrder.count({ where: { menuId: menu.id } })).toBe(1);
    const again = await saveGuestMealOrder(adminRow, { menuId: menu.id, guestOrderId: guest.id, guestName: "Faz3 Misafir", ...ids }, open);
    expect(again.id).toBe(guest.id);
    expect(await db.mealGuestOrder.count({ where: { menuId: menu.id } })).toBe(1);

    const spend = await getMealSpendReport(adminRow, Number(date.slice(0, 4)));
    const day = spend.months.flatMap((month) => month.days).find((item) => item.date === date);
    expect(day?.missing).toBe(true);
    expect(day?.totalLabel).toBe("Toplam hesaplanamıyor");
    expect(day?.guests.map((person) => person.personName)).toContain("Faz3 Misafir");
    expect(spend.months.find((month) => month.days.some((item) => item.date === date))?.totalLabel).toBe("Toplam hesaplanamıyor");

    const reminder = await prepareMealReminder(adminRow, { userId: pendingRow.id, menuId: menu.id }, open);
    expect(reminder.delivered).toBe(false);
    expect(reminder.message).toContain("Telegram bağlantısı yok");
    expect(await db.telegramDispatch.count({ where: { dedupeKey: { contains: pendingRow.id } } })).toBe(0);
    expect(await db.mealDish.count({ where: { NOT: { name: { startsWith: "Faz3" } } } })).toBe(beforeDishes);
  });

  it("eksik ortam değişkeninde yönetici komutu hesap açmaz", () => {
    if (process.env.ADMIN_NAME || process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) {
      return;
    }

    const result = spawnSync("npm", ["run", "admin:create"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ADMIN_NAME: "",
        ADMIN_EMAIL: "",
        ADMIN_PASSWORD: "",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ADMIN_NAME");
    expect(result.stderr).toContain("ADMIN_EMAIL");
    expect(result.stderr).toContain("ADMIN_PASSWORD");
    expect(result.stderr).not.toContain("scrypt$");
  });
});
