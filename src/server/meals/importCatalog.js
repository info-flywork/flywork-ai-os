export { CATALOG_IMPORT_TEMPLATE } from "@/server/meals/catalogTemplate";

export const MAX_CATALOG_ROWS = 400;
export const MAX_IMPORT_PHOTOS = 10;

const SLOT_TITLES = {
  MAIN: "Ana yemek",
  SOUP: "Çorba",
  SIDE: "Pilav / garnitür",
  DESSERT: "Tatlı",
};

const SLOT_LABELS = {
  "ana yemek": "MAIN",
  main: "MAIN",
  ana: "MAIN",
  corba: "SOUP",
  soup: "SOUP",
  tatli: "DESSERT",
  tatlı: "DESSERT",
  tatlilar: "DESSERT",
  dessert: "DESSERT",
  "pilav / garnitur": "SIDE",
  "pilav/garnitur": "SIDE",
  garnitur: "SIDE",
  pilav: "SIDE",
  side: "SIDE",
};

 




































































export function foldCatalogText(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u");
}

export function formatCatalogImportResult(result) {
  const successful = result.created + result.photosAttached;
  return `Başarılı: ${successful}. Atlanan: ${result.skipped}. Başarısız: ${result.failed}. Eksik fotoğraf: ${result.missingPhotos}.`;
}

export function formatCatalogPreviewSummary(result) {
  const matched = result.skipped + result.photosAttached;
  return `Yeni kayıt: ${result.created}. Eşleşen: ${matched}. Hatalı: ${result.failed}. Eksik fotoğraf: ${result.missingPhotos}.`;
}

export function catalogPhotoMaterial(photos) {
  const sorted = photos
    .map((photo, index) => ({ photo, index }))
    .sort((left, right) => {
      const byName = left.photo.name.localeCompare(right.photo.name, "tr");
      if (byName !== 0) {
        return byName;
      }
      const bySize = left.photo.bytes.byteLength - right.photo.bytes.byteLength;
      return bySize === 0 ? left.index - right.index : bySize;
    });
  const encoder = new TextEncoder();
  const parts = [];
  for (const { photo } of sorted) {
    parts.push(encoder.encode(photo.name), new Uint8Array([0]), photo.bytes, new Uint8Array([0]));
  }
  const merged = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return merged;
}

export function previewMatchesSource(preview, source) {
  if (!preview || !source) {
    return false;
  }
  return (
    preview.source.fileName === source.fileName &&
    preview.source.fileBytes === source.fileBytes &&
    preview.source.fileDigest === source.fileDigest &&
    preview.source.photoDigest === source.photoDigest
  );
}

export function formatCatalogPrice(value) {
  if (!value) {
    return "";
  }
  const [whole, fraction = ""] = value.split(".");
  return `${whole},${fraction.padEnd(2, "0").slice(0, 2)} TL`;
}

export function parseCatalogPrice(value) {
  const compact = value.trim().replace(/\s+/g, "").replace(/^\+/, "").replace(/(try|tl)$/i, "");
  if (!compact) {
    return { ok: true, price: null };
  }
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(compact)) {
    return { ok: false, message: "Fiyat geçersiz. Örnek: 19,90" };
  }
  const [whole, fraction = ""] = compact.split(/[.,]/);
  if (whole.length > 8) {
    return { ok: false, message: "Fiyat geçersiz. Örnek: 19,90" };
  }
  const digits = whole.replace(/^0+(?=\d)/, "") || "0";
  return { ok: true, price: `${digits}.${fraction.padEnd(2, "0")}` };
}

export function toCatalogPreview(rows, source) {
  return {
    source,
    rows: rows.map((row) => ({
      line: row.line,
      name: row.name,
      outcome: row.outcome,
      missingPhoto: row.missingPhoto,
      message: row.message,
      categoryLabel: row.categoryLabel,
      slotLabel: row.slotLabel,
      priceLabel: formatCatalogPrice(row.price),
      description: row.description ?? "",
    })),
    created: rows.filter((row) => row.outcome === "create").length,
    skipped: rows.filter((row) => row.outcome === "skip").length,
    failed: rows.filter((row) => row.outcome === "error").length,
    missingPhotos: rows.filter((row) => row.missingPhoto && row.outcome !== "error").length,
    photosAttached: rows.filter((row) => row.outcome === "attach-photo").length,
  };
}

function headerIndex(headers, aliases) {
  const folded = headers.map((header) => foldCatalogText(header));
  return folded.findIndex((header) => aliases.some((alias) => header === foldCatalogText(alias)));
}

function detectDelimiter(text) {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let index = 0; index < first.length; index += 1) {
    const char = first[index];
    if (char === '"') {
      if (quoted && first[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted) {
      continue;
    }
    if (char === ",") {
      commas += 1;
    }
    if (char === ";") {
      semicolons += 1;
    }
  }
  return semicolons > commas ? ";" : ",";
}

function splitCsv(text, delimiter) {
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const pushRow = () => {
    row.push(cell.trim());
    cell = "";
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
    row = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
      pushRow();
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows;
}

function draftFromCells(
  line,
  cells,
  columns,
) {
  const read = (index) => (index >= 0 ? cells[index] ?? "" : "");
  return {
    line,
    name: read(columns.name),
    categoryName: read(columns.category),
    slotText: read(columns.slot),
    activeText: read(columns.active),
    photoText: read(columns.photo),
    priceText: read(columns.price),
    descriptionText: read(columns.description),
  };
}

function parseCsvCatalog(text) {
  const table = splitCsv(text, detectDelimiter(text));
  if (table.length === 0) {
    return { ok: false, message: "Dosya boş." };
  }
  const headers = table[0];
  const columns = {
    name: headerIndex(headers, ["ad", "yemek", "yemek adi", "name"]),
    category: headerIndex(headers, ["kategori", "category"]),
    slot: headerIndex(headers, ["grup", "secim grubu", "slot"]),
    photo: headerIndex(headers, ["fotograf", "fotograf yolu", "foto", "photo"]),
    active: headerIndex(headers, ["aktif", "aktiflik", "active"]),
    price: headerIndex(headers, ["fiyat", "price", "tutar"]),
    description: headerIndex(headers, ["aciklama", "description"]),
  };
  if (columns.name < 0 || columns.category < 0 || columns.slot < 0 || columns.active < 0) {
    return { ok: false, message: "Başlıklar ad, kategori, grup ve aktiflik kolonlarını içermeli." };
  }
  const body = table.slice(1);
  if (body.length === 0) {
    return { ok: false, message: "Aktarılacak satır yok." };
  }
  if (body.length > MAX_CATALOG_ROWS) {
    return { ok: false, message: `Tek aktarımda en fazla ${MAX_CATALOG_ROWS} satır olabilir.` };
  }
  return { ok: true, rows: body.map((cells, index) => draftFromCells(index + 2, cells, columns)) };
}

function jsonValue(record, aliases) {
  for (const [key, value] of Object.entries(record)) {
    if (!aliases.some((alias) => foldCatalogText(alias) === foldCatalogText(key))) {
      continue;
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (value === null || value === undefined) {
      return "";
    }
    return String(value).trim();
  }
  return "";
}

function parseJsonCatalog(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "JSON dosyası okunamadı." };
  }
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed ).yemekler)
      ? (parsed ).yemekler
      : parsed && typeof parsed === "object" && Array.isArray((parsed ).dishes)
        ? (parsed ).dishes
        : null;
  if (!records) {
    return { ok: false, message: "JSON bir yemek listesi olmalı." };
  }
  if (records.length === 0) {
    return { ok: false, message: "Aktarılacak satır yok." };
  }
  if (records.length > MAX_CATALOG_ROWS) {
    return { ok: false, message: `Tek aktarımda en fazla ${MAX_CATALOG_ROWS} satır olabilir.` };
  }
  const rows = [];
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      rows.push({
        line: index + 1,
        name: "",
        categoryName: "",
        slotText: "",
        activeText: "",
        photoText: "",
        priceText: "",
        descriptionText: "",
      });
      continue;
    }
    const fields = record ;
    rows.push({
      line: index + 1,
      name: jsonValue(fields, ["ad", "yemek", "yemek adi", "name"]),
      categoryName: jsonValue(fields, ["kategori", "category"]),
      slotText: jsonValue(fields, ["grup", "secim grubu", "slot"]),
      activeText: jsonValue(fields, ["aktif", "aktiflik", "active"]),
      photoText: jsonValue(fields, ["fotograf", "fotograf yolu", "foto", "photo"]),
      priceText: jsonValue(fields, ["fiyat", "price", "tutar"]),
      descriptionText: jsonValue(fields, ["aciklama", "description"]),
    });
  }
  return { ok: true, rows };
}

export function parseCatalogDocument(
  filename,
  text,
) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return { ok: false, message: "Dosya boş." };
  }
  const lower = filename.toLocaleLowerCase("tr");
  if (lower.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonCatalog(trimmed);
  }
  return parseCsvCatalog(trimmed);
}

export function photoReference(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { name: "" };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return { error: "Fotoğraf yolu sunucudan okunmaz. Dosya adını yazıp fotoğrafı birlikte yükleyin." };
  }
  if (trimmed.includes("..")) {
    return { error: "Fotoğraf yolu geçersiz." };
  }
  const base = trimmed.split(/[/\\]/).pop() ?? "";
  if (!/^[^/\\]{1,180}\.(jpe?g|png|webp)$/i.test(base)) {
    return { error: "Fotoğraf JPEG, PNG veya WEBP dosya adı olmalı." };
  }
  return { name: base };
}

function parseActive(value) {
  const folded = foldCatalogText(value);
  if (["aktif", "active", "true", "evet", "1", "yes"].includes(folded)) {
    return true;
  }
  if (["pasif", "passive", "false", "hayir", "0", "no"].includes(folded)) {
    return false;
  }
  return null;
}

export function buildCatalogPlan(
  drafts,
  categories,
  dishes,
  photos,
) {
  const categoryByName = new Map(categories.map((category) => [foldCatalogText(category.name), category]));
  const dishesByName = new Map();
  for (const dish of dishes) {
    const key = foldCatalogText(dish.name);
    dishesByName.set(key, [...(dishesByName.get(key) ?? []), dish]);
  }
  const seen = new Set();
  return drafts.map((draft) => {
    const errors = [];
    const name = draft.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 120) {
      errors.push("Yemek adı 2 ile 120 karakter arasında olmalı.");
    }
    const category = categoryByName.get(foldCatalogText(draft.categoryName));
    if (!draft.categoryName.trim()) {
      errors.push("Kategori gerekli.");
    } else if (!category) {
      errors.push("Kategori mevcut katalogla eşleşmiyor.");
    } else if (!category.active) {
      errors.push("Kategori pasif.");
    }
    const dessertCategory = foldCatalogText(draft.categoryName) === "tatlilar";
    const parsedSlot = SLOT_LABELS[foldCatalogText(draft.slotText)] ?? null;
    const slot = dessertCategory ? "DESSERT" : parsedSlot;
    const dessertMoved = dessertCategory && parsedSlot !== "DESSERT";
    if (!slot) {
      errors.push("Seçim grubu ana yemek, çorba, pilav / garnitür veya tatlı olmalı.");
    }
    const priced = parseCatalogPrice(draft.priceText);
    if (!priced.ok) {
      errors.push(priced.message);
    }
    const description = draft.descriptionText.trim();
    if (description.length > 500) {
      errors.push("Açıklama 500 karakteri aşamaz.");
    }
    const price = priced.ok ? priced.price : null;
    const active = parseActive(draft.activeText);
    if (active === null) {
      errors.push("Aktiflik aktif veya pasif olmalı.");
    }
    const reference = photoReference(draft.photoText);
    let photo = null;
    let missingPhoto = false;
    if ("error" in reference) {
      errors.push(reference.error);
    } else if (!reference.name) {
      missingPhoto = true;
    } else {
      const found = photos.get(foldCatalogText(reference.name));
      if (!found) {
        missingPhoto = true;
      } else if (!found.ok) {
        errors.push(found.message);
      } else {
        photo = { bytes: found.bytes, contentType: found.contentType };
      }
    }
    const categoryLabel = category?.name ?? (draft.categoryName.trim() || "yok");
    const slotLabel = slot ? SLOT_TITLES[slot] : draft.slotText.trim() || "geçersiz";
    if (errors.length > 0) {
      return {
        line: draft.line,
        name: name || `Satır ${draft.line}`,
        outcome: "error",
        missingPhoto: false,
        message: errors.join(" "),
        categoryId: null,
        categoryLabel,
        dishId: null,
        slot: null,
        slotLabel,
        active: null,
        price,
        description: description || null,
        photo: null,
      };
    }
    const key = foldCatalogText(name);
    if (seen.has(key)) {
      return {
        line: draft.line,
        name,
        outcome: "skip",
        missingPhoto: false,
        message: "Dosyada aynı ad tekrar ediyor.",
        categoryId: category?.id ?? null,
        categoryLabel,
        dishId: null,
        slot,
        slotLabel,
        active,
        price,
        description: description || null,
        photo: null,
      };
    }
    seen.add(key);
    const matches = dishesByName.get(key) ?? [];
    if (matches.length > 1) {
      return {
        line: draft.line,
        name,
        outcome: "skip",
        missingPhoto: false,
        message: "Aynı adda birden fazla kayıt var.",
        categoryId: category?.id ?? null,
        categoryLabel,
        dishId: null,
        slot,
        slotLabel,
        active,
        price,
        description: description || null,
        photo: null,
      };
    }
    if (matches.length === 1) {
      if (photo && !matches[0].photoKey) {
        return {
          line: draft.line,
          name,
          outcome: "attach-photo",
          missingPhoto: false,
          message: "Kayıt var. Yalnızca eksik fotoğraf eklenecek.",
          categoryId: category?.id ?? null,
          categoryLabel,
          dishId: matches[0].id,
          slot,
          slotLabel,
          active,
          price,
          description: description || null,
          photo,
        };
      }
      return {
        line: draft.line,
        name,
        outcome: "skip",
        missingPhoto: false,
        message: "Aynı yemek katalogda var.",
        categoryId: category?.id ?? null,
        categoryLabel,
        dishId: matches[0].id,
        slot,
        slotLabel,
        active,
        price,
        description: description || null,
        photo: null,
      };
    }
    return {
      line: draft.line,
      name,
      outcome: "create",
      missingPhoto,
      message: `${missingPhoto ? "Yeni kayıt. Fotoğraf yok." : "Yeni kayıt."}${dessertMoved ? " Tatlılar kategorisi tatlı grubuna alındı." : ""}`,
      categoryId: category?.id ?? null,
      categoryLabel,
      dishId: null,
      slot,
      slotLabel,
      active,
      price,
      description: description || null,
      photo,
    };
  });
}
