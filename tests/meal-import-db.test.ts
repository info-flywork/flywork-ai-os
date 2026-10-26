// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import type { Actor } from "@/server/auth/permissions";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { addIsoDays, istanbulClock, upcomingMealDates } from "@/server/meals/schedule";
import { removeMealPhoto } from "@/server/meals/photos";
import { dateOnly } from "@/server/dates";
import { commitMealCatalogImport, previewMealCatalogImport } from "@/server/services/mealImport";
import { publishCatalogMenu, saveOwnMealOrder } from "@/server/services/meals";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const fixtureIds: string[] = [];

function fixtureEmail() {
  return `faz3-${randomUUID()}@example.invalid`;
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

describe.skipIf(!databaseReady)("yemek kataloğu aktarımı veritabanı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const dishes = await db.mealDish.findMany({
      where: { name: { startsWith: "Faz3 Aktar" } },
      select: { id: true, photoKey: true },
    });
    if (dishes.length > 0) {
      const items = await db.mealMenuItem.findMany({
        where: { dishId: { in: dishes.map((dish) => dish.id) } },
        select: { menuId: true },
      });
      const menuIds = [...new Set(items.map((item) => item.menuId))];
      if (menuIds.length > 0) {
        await db.mealOrder.deleteMany({ where: { menuId: { in: menuIds } } });
        await db.mealMenuItem.deleteMany({ where: { menuId: { in: menuIds } } });
        await db.mealMenu.deleteMany({ where: { id: { in: menuIds } } });
      }
      for (const dish of dishes) {
        await removeMealPhoto(dish.photoKey);
      }
      await db.mealDish.deleteMany({ where: { id: { in: dishes.map((dish) => dish.id) } } });
    }
    const leftovers = await db.user.findMany({
      where: { email: { startsWith: "faz3-", endsWith: "@example.invalid" }, id: { in: fixtureIds } },
      select: { id: true },
    });
    const userIds = leftovers.map((user) => user.id);
    if (userIds.length > 0) {
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await db.$disconnect();
  });

  it("önizleme yazmaz, onay yalnızca sağlam satırları kaydeder ve tekrarı atlar", async () => {
    const db = getPrisma();
    const before = await db.mealDish.count();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 Aktar ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 AktarCalisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const file = {
      name: "faz3.csv",
      text: [
        "ad,kategori,grup,fotograf,aktif",
        "Faz3 Aktar Ana,Tavuklu Yemekler,Ana yemek,faz3-ana.png,aktif",
        "Faz3 Aktar Ana,Tavuklu Yemekler,Ana yemek,faz3-ana.png,aktif",
        "Faz3 Aktar Eksik,Etli Yemekler,Çorba,,pasif",
        "Faz3 Aktar Bozuk,Olmayan Kategori,Ana yemek,faz3-ana.png,aktif",
        "Faz3 Aktar Resim,Mantılar,Ana yemek,bozuk.png,aktif",
      ].join("\n"),
    };
    const photos = [
      { name: "faz3-ana.png", bytes: png },
      { name: "bozuk.png", bytes: Buffer.from("yazı") },
    ];

    const preview = await previewMealCatalogImport(admin, file, photos);
    expect(await db.mealDish.count()).toBe(before);
    expect(preview.created).toBe(2);
    expect(preview.skipped).toBe(1);
    expect(preview.failed).toBe(2);
    expect(preview.missingPhotos).toBe(1);
    expect(preview.rows.find((row) => row.name === "Faz3 Aktar Resim")?.message).toMatch(/JPEG/);

    await expectCode(() => previewMealCatalogImport(employee, file, photos), "FORBIDDEN");
    await expectCode(() => commitMealCatalogImport(employee, file, photos, true), "FORBIDDEN");
    await expectCode(() => commitMealCatalogImport(admin, file, photos, false), "VALIDATION");
    expect(await db.mealDish.count()).toBe(before);

    const first = await commitMealCatalogImport(admin, file, photos, true);
    expect(first).toMatchObject({ created: 2, skipped: 1, failed: 2, missingPhotos: 1, photosAttached: 0 });
    const saved = await db.mealDish.findMany({
      where: { name: { startsWith: "Faz3 Aktar" } },
      select: { name: true, active: true, slot: true, photoKey: true, photoType: true },
    });
    expect(saved.map((dish) => dish.name).sort()).toEqual(["Faz3 Aktar Ana", "Faz3 Aktar Eksik"]);
    const ana = saved.find((dish) => dish.name === "Faz3 Aktar Ana");
    const missing = saved.find((dish) => dish.name === "Faz3 Aktar Eksik");
    expect(ana?.slot).toBe("MAIN");
    expect(ana?.photoType).toBe("image/png");
    expect(ana?.photoKey).toMatch(/^[a-f0-9]{32}$/);
    expect(missing?.active).toBe(false);
    expect(missing?.photoKey).toBeNull();
    expect(await db.mealDish.count({ where: { name: "Faz3 Aktar Bozuk" } })).toBe(0);

    const second = await commitMealCatalogImport(admin, file, photos, true);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(3);
    expect(await db.mealDish.count({ where: { name: "Faz3 Aktar Ana" } })).toBe(1);

    const photoPass = await commitMealCatalogImport(
      admin,
      {
        name: "foto.json",
        text: JSON.stringify([
          {
            ad: "Faz3 Aktar Eksik",
            kategori: "Etli Yemekler",
            grup: "Çorba",
            fotograf: "eksik.png",
            aktif: false,
          },
        ]),
      },
      [{ name: "eksik.png", bytes: png }],
      true,
    );
    expect(photoPass).toMatchObject({ created: 0, photosAttached: 1, skipped: 0, failed: 0 });
    const attached = await db.mealDish.findFirst({
      where: { name: "Faz3 Aktar Eksik" },
      select: { photoKey: true, active: true, slot: true },
    });
    expect(attached?.photoKey).toMatch(/^[a-f0-9]{32}$/);
    expect(attached?.active).toBe(false);
    expect(attached?.slot).toBe("SOUP");
  });

  it("fiyat ve açıklamayı kaydeder, mevcut kaydı değiştirmez ve tatlıyı isteğe bağlı tutar", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 AktarFiyat ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz3 AktarSiparis ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const file = {
      name: "fiyat.csv",
      text: [
        "ad,kategori,grup,fotograf,aktif,fiyat,aciklama",
        "Faz3 Aktar Fiyatli,Tavuklu Yemekler,Ana yemek,,aktif,\"19,90\",Izgara tavuk",
        "Faz3 Aktar Corba,Yan Ürünler,Çorba,,aktif,,",
        "Faz3 Aktar Pilav,Pilav Üstü,Pilav / garnitür,,aktif,,",
        "Faz3 Aktar Sutlac,Tatlılar,Pilav / garnitür,,aktif,,Fırın",
        "Faz3 Aktar Hatali,Etli Yemekler,Ana yemek,,aktif,ucuz,",
      ].join("\n"),
    };
    await expectCode(() => commitMealCatalogImport(employeeRow, file, [], true), "FORBIDDEN");
    const imported = await commitMealCatalogImport(adminRow, file, [], true);
    expect(imported.created).toBe(4);
    expect(imported.failed).toBe(1);
    const priced = await db.mealDish.findFirst({
      where: { name: "Faz3 Aktar Fiyatli" },
      select: { price: true, description: true, slot: true },
    });
    expect(Number(priced?.price)).toBe(19.9);
    expect(priced?.description).toBe("Izgara tavuk");
    expect(priced?.slot).toBe("MAIN");
    const dessert = await db.mealDish.findFirst({
      where: { name: "Faz3 Aktar Sutlac" },
      select: { slot: true, description: true, price: true },
    });
    expect(dessert?.slot).toBe("DESSERT");
    expect(dessert?.description).toBe("Fırın");
    expect(dessert?.price).toBeNull();

    const again = await commitMealCatalogImport(
      adminRow,
      {
        name: "fiyat.csv",
        text: "ad,kategori,grup,fotograf,aktif,fiyat,aciklama\nFaz3 Aktar Fiyatli,Tavuklu Yemekler,Ana yemek,,aktif,40,Degisen\n",
      },
      [],
      true,
    );
    expect(again).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    const unchanged = await db.mealDish.findFirst({
      where: { name: "Faz3 Aktar Fiyatli" },
      select: { price: true, description: true },
    });
    expect(Number(unchanged?.price)).toBe(19.9);
    expect(unchanged?.description).toBe("Izgara tavuk");

    let anchor = "2099-03-02";
    for (let step = 0; step < 21; step += 1) {
      const weekday = istanbulClock(new Date(`${anchor}T12:00:00+03:00`)).weekday;
      const existing = await db.mealMenu.findUnique({ where: { date: dateOnly(anchor) } });
      if ([1, 2, 4].includes(weekday) && !existing) {
        break;
      }
      anchor = addIsoDays(anchor, 1);
    }
    const target = upcomingMealDates(anchor, [1, 2, 4], 6).find((date) => date > anchor);
    if (!target) {
      throw new Error("Ön sipariş günü bulunamadı.");
    }
    const dishes = await db.mealDish.findMany({
      where: { name: { in: ["Faz3 Aktar Fiyatli", "Faz3 Aktar Corba", "Faz3 Aktar Pilav", "Faz3 Aktar Sutlac"] } },
      select: { id: true, slot: true },
    });
    const published = await publishCatalogMenu(adminRow, {
      date: target,
      published: true,
      dishIds: dishes.map((dish) => dish.id),
    });
    const menu = await db.mealMenu.findUniqueOrThrow({
      where: { id: published.id },
      include: { items: true },
    });
    const ids = {
      mainItemId: menu.items.find((item) => item.slot === "MAIN")?.id,
      soupItemId: menu.items.find((item) => item.slot === "SOUP")?.id,
      sideItemId: menu.items.find((item) => item.slot === "SIDE")?.id,
      dessertItemId: menu.items.find((item) => item.slot === "DESSERT")?.id,
    };
    const morning = new Date(`${anchor}T09:00:00+03:00`);
    const withoutDessert = await saveOwnMealOrder(employeeRow, { menuId: menu.id, ...ids, dessertItemId: "" }, morning);
    expect(withoutDessert.dessertItemId).toBeNull();
    const withDessert = await saveOwnMealOrder(
      employeeRow,
      { menuId: menu.id, ...ids, note: "az acı" },
      morning,
    );
    expect(withDessert.id).toBe(withoutDessert.id);
    expect(withDessert.dessertItemId).toBe(ids.dessertItemId);
    expect(await db.mealOrder.count({ where: { userId: employeeRow.id, menuId: menu.id } })).toBe(1);
    const mainPrice = menu.items.find((item) => item.slot === "MAIN");
    expect(Number(mainPrice?.price)).toBe(19.9);
    expect(mainPrice?.description).toBe("Izgara tavuk");
  });
});
