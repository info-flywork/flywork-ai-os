"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { AppError, toPublicError } from "@/server/errors";
import { formatCatalogImportResult, formatCatalogPreviewSummary } from "@/server/meals/importCatalog";
import { commitMealCatalogImport, previewMealCatalogImport } from "@/server/services/mealImport";
import { decideMealPhotoReview } from "@/server/services/photoReview";
import {
  prepareMealReminder,
  publishCatalogMenu,
  saveGuestMealOrder,
  saveManagedMealOrder,
  saveMealCategory,
  saveMealDish,
  saveMealMenu,
  cancelOwnMealOrder,
  clearOwnMealAbsence,
  saveOwnMealOrder,
  updateCatererPhone,
  updateClosingTime,
  updateMealOrderStatus,
} from "@/server/services/meals";

 

function finish(error) {
  unstable_rethrow(error);
  return { ok: false, message: toPublicError(error).message };
}

export async function saveOrderAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const text = (key) => {
      const value = formData.get(key);
      return typeof value === "string" ? value : undefined;
    };
    if (formData.get("undoAbsent") === "on") {
      await clearOwnMealAbsence(user, text("menuId") ?? "");
      revalidatePath("/yemek-yonetimi");
      revalidatePath("/");
      return { ok: true, message: "Ofiste olmama durumu geri alındı." };
    }
    if (formData.get("cancelOrder") === "on") {
      const cancelled = await cancelOwnMealOrder(user, text("menuId") ?? "");
      revalidatePath("/yemek-yonetimi");
      revalidatePath("/");
      return { ok: true, message: cancelled.cancelled ? "Siparişiniz iptal edildi." : "İptal edilecek sipariş yok." };
    }
    const saved = await saveOwnMealOrder(user, {
      menuId: text("menuId"),
      itemId: text("itemId"),
      mainItemId: text("mainItemId"),
      soupItemId: text("soupItemId"),
      sideItemId: text("sideItemId"),
      dessertItemId: text("dessertItemId"),
      absent: formData.get("absent") === "on",
      note: text("note"),
    });
    revalidatePath("/yemek-yonetimi");
    revalidatePath("/");
    return {
      ok: true,
      message: saved.changed ? "Siparişiniz güncellendi." : "Siparişiniz kaydedildi.",
    };
  } catch (error) {
    return finish(error);
  }
}

export async function saveMenuAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const items = String(formData.get("items") ?? "")
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    await saveMealMenu(user, {
      date: formData.get("date"),
      note: String(formData.get("note") ?? "").trim(),
      published: formData.get("published") === "on",
      items,
    });
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: "Menü kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function catererPhoneAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    await updateCatererPhone(user, { catererPhone: String(formData.get("catererPhone") ?? "") });
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: "Yemekçi numarası kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function closingTimeAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    await updateClosingTime(user, { closesAt: formData.get("closesAt") });
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: "Kapanış saati güncellendi." };
  } catch (error) {
    return finish(error);
  }
}

async function uploadedPhoto(formData) {
  const file = formData.get("foto");
  if (!(file instanceof File) || file.size === 0) {
    return undefined;
  }
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type || "application/octet-stream",
  };
}

export async function saveCategoryAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    await saveMealCategory(user, { name: formData.get("name") });
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: "Kategori kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function saveDishAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    await saveMealDish(
      user,
      {
        id: formData.get("id"),
        name: formData.get("name"),
        categoryId: formData.get("categoryId"),
        slot: formData.get("slot"),
        active: formData.get("active") === "on",
        price: formData.get("price"),
        description: formData.get("description"),
      },
      await uploadedPhoto(formData),
    );
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: "Yemek kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function publishCatalogAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const saved = await publishCatalogMenu(user, {
      date: formData.get("date"),
      note: String(formData.get("note") ?? "").trim(),
      published: formData.get("yayin") === "yayin",
      dishIds: formData.getAll("dishIds").filter((value) => typeof value === "string"),
    });
    revalidatePath("/yemek-yonetimi");
    if (saved.conflicts.length > 0) {
      const lines = saved.conflicts.map((conflict) => `${conflict.employeeName}: ${conflict.itemName}`).join(", ");
      return {
        ok: true,
        message: `Menü kaydedildi. Geçersiz kalan seçimler: ${lines}. Siparişler başka yemekle değiştirilmedi.`,
      };
    }
    return {
      ok: true,
      message: saved.published ? "Menü yayınlandı. Çalışanlar bugünü görebilir." : "Menü taslak olarak kaydedildi.",
    };
  } catch (error) {
    return finish(error);
  }
}

 






const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

async function catalogUpload(formData) {
  const file = formData.get("dosya");
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError("Katalog dosyası seçin.", "VALIDATION", 400);
  }
  if (file.size > 1024 * 1024) {
    throw new AppError("Katalog dosyası 1 MB sınırını aşıyor.", "VALIDATION", 400);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return { name: file.name || "katalog.csv", text: bytes.toString("utf8"), bytes };
}

async function catalogPhotos(formData) {
  const photos = [];
  for (const value of formData.getAll("fotograflar")) {
    if (!(value instanceof File) || value.size === 0) {
      continue;
    }
    if (value.size > MAX_PHOTO_BYTES) {
      throw new AppError("Her fotoğraf 2 MB sınırını aşmamalı.", "VALIDATION", 400);
    }
    photos.push({
      name: value.name,
      bytes: Buffer.from(await value.arrayBuffer()),
    });
  }
  return photos;
}

export async function importCatalogAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const file = await catalogUpload(formData);
    const photos = await catalogPhotos(formData);
    if (formData.get("onay") === "on") {
      const result = await commitMealCatalogImport(user, file, photos, true);
      revalidatePath("/yemek-yonetimi");
      return {
        ok: result.failed === 0,
        message: formatCatalogImportResult(result),
        committed: true,
      };
    }
    const preview = await previewMealCatalogImport(user, file, photos);
    return {
      ok: true,
      message: `Önizleme hazır. Kayıt yazılmadı. ${formatCatalogPreviewSummary(preview)}`,
      preview,
      committed: false,
    };
  } catch (error) {
    return finish(error);
  }
}

export async function decidePhotoReviewAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const decision = formData.get("decision");
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      throw new AppError("Karar onay veya ret olmalı.", "VALIDATION", 400);
    }
    const saved = await decideMealPhotoReview(user, String(formData.get("dishKey") ?? ""), decision );
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: saved.message };
  } catch (error) {
    return finish(error);
  }
}

function mealFields(formData) {
  const text = (key) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : undefined;
  };
  return {
    menuId: text("menuId"),
    itemId: text("itemId"),
    mainItemId: text("mainItemId"),
    soupItemId: text("soupItemId"),
    sideItemId: text("sideItemId"),
    dessertItemId: text("dessertItemId"),
    absent: formData.get("absent") === "on",
    note: text("note"),
  };
}

export async function saveManagedOrderAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const saved = await saveManagedMealOrder(user, {
      ...mealFields(formData),
      userId: formData.get("userId"),
    });
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: saved.changed ? "Çalışan siparişi güncellendi." : "Çalışan siparişi kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function saveGuestOrderAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const saved = await saveGuestMealOrder(user, {
      ...mealFields(formData),
      guestName: formData.get("guestName"),
      guestOrderId: formData.get("guestOrderId"),
      absent: false,
    });
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: saved.changed ? "Misafir siparişi güncellendi." : "Misafir siparişi kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function remindMealAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    const saved = await prepareMealReminder(user, {
      menuId: formData.get("menuId"),
      userId: formData.get("userId"),
    });
    revalidatePath("/yemek-yonetimi");
    return { ok: saved.delivered, message: saved.message };
  } catch (error) {
    return finish(error);
  }
}

export async function orderStatusAction(
  _previous,
  formData,
) {
  try {
    const user = await requireUser();
    await updateMealOrderStatus(user, String(formData.get("orderId") ?? ""), {
      status: formData.get("status"),
    });
    revalidatePath("/yemek-yonetimi");
    return { ok: true, message: "Sipariş durumu güncellendi." };
  } catch (error) {
    return finish(error);
  }
}
