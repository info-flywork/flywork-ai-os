import { foldCatalogText } from "@/server/meals/importCatalog";

 

















const IMAGE_URL = /^https:\/\/adilesultan\.restapp\.com\/uploads\/95539\/[a-f0-9]{32}\.(?:jpe?g|png|webp)$/i;
const PAGE_URL = /^https:\/\/siparis\.adilesultanevyemekleri\.com\/product\/[a-z0-9-]+$/;

export function photoNameKey(value) {
  return foldCatalogText(
    value
      .replace(/\(\s*\+?\d+(?:[.,]\d+)?\s*\)/g, " ")
      .replace(/\+/g, " ")
      .replace(/\./g, " ")
      .replace(/\s+/g, " "),
  );
}

function withoutPortion(value) {
  return photoNameKey(value.replace(/\(\s*\d+\s*(?:adet|gr)\.?\s*\)/gi, " "));
}

function withoutSugar(value) {
  return photoNameKey(value.replace(/\(\s*şeker ilavesiz\s*\)/gi, " "));
}

function editDistance(left, right) {
  if (Math.abs(left.length - right.length) > 1) {
    return 2;
  }
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j] ?? 0;
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, previous + cost);
      previous = current;
    }
  }
  return row[right.length] ?? 2;
}

function usable(products) {
  return products.filter((product) => IMAGE_URL.test(product.imageUrl) && PAGE_URL.test(product.pageUrl));
}

export function buildPhotoReview(dishes, products) {
  const pool = usable(products);
  const byKey = new Map();
  const imageCount = new Map();
  for (const product of pool) {
    const key = photoNameKey(product.name);
    byKey.set(key, [...(byKey.get(key) ?? []), product]);
    imageCount.set(product.imageUrl, (imageCount.get(product.imageUrl) ?? 0) + 1);
  }
  const exactKeys = new Set(dishes.map((dish) => photoNameKey(dish)));

  return dishes.map((dishName) => {
    const dishKey = photoNameKey(dishName);
    const exact = byKey.get(dishKey) ?? [];
    if (exact.length === 1) {
      const sharedImage = (imageCount.get(exact[0].imageUrl) ?? 0) > 1;
      return {
        dishName,
        dishKey,
        status: sharedImage ? "manuel" : "kesin",
        reason: sharedImage
          ? "Adlar birebir eşleşiyor. Aynı görsel dosyası başka yemekte de duruyor."
          : "Adlar birebir eşleşiyor.",
        sharedImage,
        candidates: exact,
      };
    }
    if (exact.length > 1) {
      return row(dishName, dishKey, "Bu adla birden fazla ürün var.", exact);
    }
    const portions = pool.filter((product) => withoutPortion(product.name) === dishKey && photoNameKey(product.name) !== dishKey);
    if (portions.length > 0) {
      return row(dishName, dishKey, "Sitede aynı adın porsiyonu farklı kayıtları var.", portions);
    }
    const yogurtKey = dishKey.replace(/ yogurt$/, "");
    const yogurt = yogurtKey === dishKey ? [] : (byKey.get(yogurtKey) ?? []);
    if (yogurt.length === 1) {
      return row(dishName, dishKey, "Katalog adında yoğurt geçiyor. Sitedeki ad yoğurtsuz.", yogurt);
    }
    const sugar = pool.filter((product) => withoutSugar(product.name) === dishKey && photoNameKey(product.name) !== dishKey);
    if (sugar.length === 1) {
      return row(dishName, dishKey, "Sitedeki ad şeker ilavesiz ifadesi taşıyor.", sugar);
    }
    const typos = pool.filter((product) => {
      const key = photoNameKey(product.name);
      return key.length >= 10 && dishKey.length >= 10 && editDistance(dishKey, key) === 1 && !exactKeys.has(key);
    });
    if (typos.length === 1) {
      return row(dishName, dishKey, "Adlarda tek harflik yazım farkı var.", typos);
    }
    return row(dishName, dishKey, "Herkese açık menüde bu ad yok.", []);
  });
}

function row(dishName, dishKey, reason, candidates) {
  return {
    dishName,
    dishKey,
    status: candidates.length > 0 ? "manuel" : "yok",
    reason,
    sharedImage: false,
    candidates,
  };
}

export function photoPublishBlock(input




) {
  if (input.decision !== "APPROVED") {
    return "Yönetici onayı olmadan fotoğraf yazılmaz.";
  }
  if (!input.rightsVerified) {
    return "Kullanım hakkı doğrulanmadan fotoğraf yazılmaz.";
  }
  if (input.candidateCount !== 1) {
    return "Tek görsel eşleşmesi yok.";
  }
  if (input.sharedImage) {
    return "Aynı görsel başka yemekte kullanılıyor.";
  }
  return null;
}
