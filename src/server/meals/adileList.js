 

















const SECTION_HEADERS = new Set([
  "SEBZELİ YEMEKLER",
  "TAVUKLU YEMEKLER",
  "ETLİ YEMEKLER",
  "MANTILAR",
  "ETLİ SEBZELİ YEMEKLER",
  "SEBZELİ ÜRÜNLER",
  "MAKARNALAR",
  "PİLAV ÜSTÜ",
  "YAN ÜRÜNLER",
  "TATLILAR",
]);

const EXTRA_SECTIONS = new Set(["YAN ÜRÜNLER", "TATLILAR"]);
const EXCLUDED_NAMES = new Set(["KELLE PAÇA ÇORBASI (ANTEP USULÜ)"]);

function fold(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

function titleCase(value) {
  return fold(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/(^|\s)\S/g, (part) => part.toLocaleUpperCase("tr-TR"));
}

export function choiceSlug(value) {
  return fold(value)
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function money(value) {
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) {
    return null;
  }
  const raw = match[1] ?? "";
  const normalized = raw.includes(",") ? raw.replaceAll(".", "").replace(",", ".") : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function isPriceCell(value) {
  return /^\s*\+?\d+(?:[.,]\d+)?\s*(?:TL\.?)?\s*$/i.test(value.trim());
}

function extraAmount(value) {
  const match = value.match(/\(\+?\s*(\d+(?:[.,]\d+)?)\s*\)/);
  return match ? money(match[1] ?? "") ?? 0 : 0;
}

function cleanName(value) {
  return value
    .replace(/\(\+?\s*\d+(?:[.,]\d+)?\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeSide(value) {
  const text = fold(cleanName(value));
  if (text.includes("ÜSTÜ")) {
    return false;
  }
  const sideWord = text.includes("PİLAV") || text.includes("PÜRE") || text.includes("ERİŞTE") || text.includes("MAKARNA");
  const dishWord = text.includes("TAVUK") || text.includes("ETLİ") || text.includes("KÖFTE") || text.includes("KEBAP") || text.includes("HİNDİ") || text.includes("MANTI");
  return sideWord && !dishWord;
}

function isHeader(value) {
  return SECTION_HEADERS.has(fold(value));
}

function isModePhrase(value) {
  const text = fold(value);
  return text.includes("TÜM ÇORBA") || text.includes("PİLAV VEYA ÇORBA") || text.includes("PILAV VEYA CORBA");
}

function soupCatalog(rows) {
  const names = new Set();
  for (const row of rows) {
    const cells = row.cells.map((cell) => cell.trim()).filter(Boolean);
    if (cells.some((cell) => isHeader(cell))) {
      break;
    }
    for (const cell of cells) {
      if (!isPriceCell(cell)) {
        const name = cleanName(cell);
        if (name) {
          names.add(fold(name));
        }
      }
    }
  }
  return names;
}

function excludedName(value) {
  return EXCLUDED_NAMES.has(fold(cleanName(value)));
}

function isSoupName(value, catalog) {
  if (excludedName(value)) {
    return false;
  }
  const name = fold(cleanName(value));
  return name.includes("ÇORBA") || catalog.has(name);
}















function addSoup(group, name, price) {
  const clean = cleanName(name);
  if (!clean || excludedName(clean)) {
    return;
  }
  const current = group.soups.get(clean) ?? 0;
  group.soups.set(clean, Math.max(current, price));
}

function addSide(group, name) {
  const clean = cleanName(name);
  if (clean) {
    group.sides.add(clean);
  }
}

function readCompanion(group, value, catalog) {
  const text = fold(value);
  if (isModePhrase(value)) {
    if (text.includes("TÜM ÇORBA")) {
      group.allSoups = true;
    }
    if (text.includes("SALATA") && !text.includes("CACIK")) {
      group.salad = true;
      group.allSoups = true;
      addSide(group, "Salata");
    }
    if (text.includes("PİLAV VEYA ÇORBA") || text.includes("PILAV VEYA CORBA")) {
      group.allSoups = true;
      group.or = true;
      addSide(group, "BULGUR PİLAVI");
      addSide(group, "ŞEHRİYELİ PİRİNÇ PİLAVI");
    }
  } else if (isSoupName(value, catalog)) {
    addSoup(group, value, extraAmount(value));
    return;
  }
  for (const part of value.split(/\s+veya\s+|,/i)) {
    const label = fold(part);
    if (label.includes("SALATA")) {
      addSide(group, "Salata");
    }
    if (label.includes("CACIK")) {
      addSide(group, "Cacık");
    }
    if ((label.includes("PİLAV") || label.includes("PÜRE") || label.includes("ERİŞTE") || label.includes("MAKARNA")) && !label.includes("ÇORBA") && !label.includes("VEYA")) {
      addSide(group, part);
    }
  }
}

export function parseAdileRows(rows) {
  const catalog = soupCatalog(rows);
  const groups = [];
  const standalone = [];
  const unpriced = [];
  const masterSoups = new Map();
  let section = "";
  let group = null;

  function openGroup(title, price, slot) {
    const salad = section === "ETLİ YEMEKLER" || section === "MANTILAR";
    const next = {
      key: choiceSlug(title),
      title,
      category: titleCase(section || title),
      price,
      slot,
      mains: [],
      soups: new Map(),
      sides: new Set(salad ? ["Salata"] : []),
      allSoups: salad,
      or: false,
      salad,
    };
    groups.push(next);
    return next;
  }

  for (const row of rows) {
    const cells = row.cells.map((cell) => cell.trim()).filter(Boolean);
    if (cells.length === 0) {
      continue;
    }
    const header = cells.find((cell) => isHeader(cell));
    if (header) {
      section = fold(header);
      group = null;
      const priceCell = cells.find((cell) => isPriceCell(cell));
      const price = priceCell ? money(priceCell) : null;
      if (price && price > 0 && !EXTRA_SECTIONS.has(section)) {
        group = openGroup(header, price, "MAIN");
      }
      continue;
    }

    if (!section) {
      for (const cell of cells) {
        if (isSoupName(cell, catalog) && !excludedName(cell)) {
          const name = cleanName(cell);
          masterSoups.set(name, Math.max(masterSoups.get(name) ?? 0, extraAmount(cell)));
        }
      }
      continue;
    }

    const priceCell = cells.find((cell) => isPriceCell(cell));
    const price = priceCell ? money(priceCell) : null;
    const texts = cells.filter((cell) => cell !== priceCell);
    if (EXTRA_SECTIONS.has(section)) {
      const name = cleanName(texts.find((cell) => !isPriceCell(cell) && !isModePhrase(cell)) ?? "");
      if (!name || excludedName(name)) {
        continue;
      }
      if (!price || price <= 0) {
        unpriced.push(name);
        continue;
      }
      standalone.push({
        name,
        category: titleCase(section),
        slot: section === "TATLILAR" ? "DESSERT" : "MAIN",
        price,
        choiceKey: choiceSlug(name),
      });
      continue;
    }

    if (price && price > 0) {
      const title = cleanName(texts.find((cell) => !isModePhrase(cell) && !isSoupName(cell, catalog)) ?? texts[0] ?? section);
      if (!excludedName(title)) {
        group = openGroup(title, price, "MAIN");
      }
    }
    if (!group) {
      continue;
    }
    const mainCell = texts.find((cell) => !isModePhrase(cell) && !isSoupName(cell, catalog) && !isPriceCell(cell));
    if (mainCell && !price && looksLikeSide(mainCell)) {
      addSide(group, mainCell);
    } else if (mainCell) {
      const name = cleanName(mainCell);
      if (name && !excludedName(name) && !group.mains.some((item) => fold(item.name) === fold(name))) {
        group.mains.push({ name, extra: extraAmount(mainCell) });
      }
    }
    for (const cell of texts) {
      if (cell === mainCell) {
        continue;
      }
      if (isModePhrase(cell) || isSoupName(cell, catalog) || fold(cell).includes("SALATA") || fold(cell).includes("CACIK") || fold(cell).includes("PİLAV") || fold(cell).includes("PÜRE") || fold(cell).includes("ERİŞTE") || fold(cell).includes("MAKARNA")) {
        readCompanion(group, cell, catalog);
      }
    }
  }

  const knownSoups = new Map(masterSoups);
  for (const item of groups) {
    for (const [name, price] of item.soups) {
      knownSoups.set(name, Math.max(knownSoups.get(name) ?? 0, price));
    }
  }
  const dishes = [...standalone];
  const summary = [];
  for (const item of groups) {
    if (item.allSoups) {
      for (const [name, price] of knownSoups) {
        addSoup(item, name, price);
      }
    }
    for (const main of item.mains) {
      dishes.push({
        name: main.name,
        category: item.category,
        slot: item.slot,
        price: Math.round((item.price + main.extra) * 100) / 100,
        choiceKey: item.salad ? `${item.key}:salad` : item.or ? `${item.key}:or` : item.key,
      });
    }
    for (const [name, price] of item.soups) {
      dishes.push({ name, category: "Çorbalar", slot: "SOUP", price, choiceKey: item.key });
    }
    for (const name of item.sides) {
      dishes.push({ name, category: item.category, slot: "SIDE", price: 0, choiceKey: item.key });
    }
    summary.push({
      key: item.key,
      title: item.title,
      price: item.price,
      mains: item.mains.length,
      soups: item.soups.size,
      sides: item.sides.size,
    });
  }

  return { dishes, groups: summary, unpriced };
}
