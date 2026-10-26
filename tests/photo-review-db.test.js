// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";

import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { adilePhotoRows } from "@/server/meals/adilePhotoReport";
import { decideMealPhotoReview, listMealPhotoReviews } from "@/server/services/photoReview";
import { saveDishPhotoLink } from "@/server/services/photoLink";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds = [];
const fixtureDishIds = [];

function fixtureEmail() {
  return `faz4-${randomUUID()}@example.invalid`;
}

async function expectCode(work, code) {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error ).code).toBe(code);
    return;
  }
  throw new Error(`Beklenen hata oluşmadı: ${code}`);
}

describe.skipIf(!databaseReady)("yemek fotoğrafı incelemesi", () => {
  afterAll(async () => {
    if (!databaseReady || fixtureIds.length === 0) {
      return;
    }
    const db = getPrisma();
    if (fixtureDishIds.length > 0) {
      await db.mealPhotoLink.deleteMany({ where: { dishId: { in: fixtureDishIds } } });
      await db.mealDish.deleteMany({ where: { id: { in: fixtureDishIds } } });
    }
    await db.mealPhotoReview.deleteMany({ where: { decidedById: { in: fixtureIds } } });
    await db.session.deleteMany({ where: { userId: { in: fixtureIds } } });
    await db.user.deleteMany({ where: { id: { in: fixtureIds } } });
    await db.$disconnect();
  });

  it("kararı kaydeder, yemek kaydına ve dosyaya dokunmaz", async () => {
    const db = getPrisma();
    const before = await db.mealDish.count();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 Inceleme ${randomUUID().slice(0, 8)}`,
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
    fixtureIds.push(adminRow.id, employeeRow.id);
    const admin = adminRow;
    const employee = employeeRow;
    const exact = adilePhotoRows().find((row) => row.dishName === "KURU FASULYE");
    const missing = adilePhotoRows().find((row) => row.dishName === "KABAK TATLISI");
    expect(exact?.status).toBe("kesin");
    expect(missing?.status).toBe("yok");
    if (!exact || !missing) {
      return;
    }

    await expectCode(() => listMealPhotoReviews(employee), "FORBIDDEN");
    await expectCode(() => decideMealPhotoReview(employee, exact.dishKey, "APPROVED"), "FORBIDDEN");
    await expectCode(() => decideMealPhotoReview(admin, missing.dishKey, "APPROVED"), "VALIDATION");

    const approved = await decideMealPhotoReview(admin, exact.dishKey, "APPROVED");
    expect(approved.published).toBe(false);
    expect(approved.message).toMatch(/yazılmadı/);
    const rejected = await decideMealPhotoReview(admin, missing.dishKey, "REJECTED");
    expect(rejected.published).toBe(false);

    const stored = await db.mealPhotoReview.findMany({
      where: { decidedById: admin.id },
      select: { dishKey: true, decision: true, imageUrl: true },
    });
    expect(stored).toHaveLength(2);
    expect(stored.find((item) => item.dishKey === exact.dishKey)?.decision).toBe("APPROVED");
    expect(stored.find((item) => item.dishKey === exact.dishKey)?.imageUrl).toMatch(/^https:\/\/adilesultan\.restapp\.com\//);
    expect(await db.mealDish.count()).toBe(before);
    expect(await db.mealDish.count({ where: { photoKey: { not: null } } })).toBe(0);

    const view = await listMealPhotoReviews(admin);
    expect(view.rightsVerified).toBe(false);
    expect(view.rows.find((row) => row.dishKey === exact.dishKey)?.decision).toBe("APPROVED");
    expect(view.rows.find((row) => row.dishKey === missing.dishKey)?.decision).toBe("REJECTED");
  });

  it("fotoğraf bağını yemek kimliğinde tutar ve dosyayı yazmaz", async () => {
    const db = getPrisma();
    const dishesBefore = await db.mealDish.count();
    const ordersBefore = await db.mealOrder.count();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 Bag ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz4 BagCalisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const dish = await db.mealDish.create({
      data: {
        name: "KURU FASULYE",
        categoryId: "cat-sebzeli",
        slot: "MAIN",
        description: "Faz4 gecici eslesme",
        active: false,
      },
      select: { id: true, photoKey: true },
    });
    fixtureDishIds.push(dish.id);

    await expectCode(() => saveDishPhotoLink(employeeRow, dish.id), "FORBIDDEN");
    await expectCode(() => saveDishPhotoLink(adminRow, "yok"), "NOT_FOUND");
    const linked = await saveDishPhotoLink(adminRow, dish.id);
    expect(linked).toEqual({ published: false, dishId: dish.id, list: "CONFIRMED" });
    await saveDishPhotoLink(adminRow, dish.id);
    const stored = await db.mealPhotoLink.findMany({ where: { dishId: dish.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.rightsVerified).toBe(false);
    expect(stored[0]?.sourceSite).toBe("https://adilesultanevyemekleri.com/");
    expect(stored[0]?.imageUrl).toMatch(/^https:\/\/adilesultan\.restapp\.com\//);
    const after = await db.mealDish.findUnique({ where: { id: dish.id }, select: { photoKey: true } });
    expect(after?.photoKey).toBeNull();
    expect(await db.mealDish.count()).toBe(dishesBefore + 1);
    expect(await db.mealOrder.count()).toBe(ordersBefore);
  });
});
