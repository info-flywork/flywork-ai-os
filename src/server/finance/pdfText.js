import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";

 
































export function documentHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readableWordCount(text) {
  return text.split(/\s+/).filter((word) => /^[\p{L}]{4,}$/u.test(word)).length;
}

export function extractPdfTextSync(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 250_000)).toString("latin1");
  const images = sample.match(/\/Subtype\s*\/Image/g)?.length ?? 0;
  if (sample.includes("/Encrypt")) {
    return {
      text: "",
      layer: "UNREADABLE",
      engine: "none",
      images,
      contentStreams: 0,
      cmapEntries: 0,
      encrypted: true,
      pdfjs: "skipped",
    };
  }

  const streams = decodeStreams(bytes);
  const cmap = new Map();
  for (const stream of streams) {
    if (stream.kind !== "cmap") {
      continue;
    }
    for (const [key, value] of parseCmap(stream.text)) {
      if (!cmap.has(key)) {
        cmap.set(key, value);
      }
    }
  }

  const chunks = [];
  let contentStreams = 0;
  for (const stream of streams) {
    if (stream.kind !== "content") {
      continue;
    }
    contentStreams += 1;
    const text = stringsFromContent(stream.text, cmap);
    if (text) {
      chunks.push(text);
    }
  }
  const outside = literalsOutsideStreams(bytes);
  if (outside) {
    chunks.push(outside);
  }
  const text = chunks.join("\n");
  return {
    text,
    layer: textLayer(text),
    engine: contentStreams > 0 ? "streams" : text.trim() ? "literals" : "none",
    images,
    contentStreams,
    cmapEntries: cmap.size,
    encrypted: false,
    pdfjs: "skipped",
  };
}

export async function extractPdfText(bytes) {
  const sync = extractPdfTextSync(bytes);
  if (sync.encrypted || (!bytes.includes(Buffer.from("startxref")) && bytes.length < 400)) {
    return sync;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  try {
    const pdfjsText = await textFromPdfjs(copy);
    const pdfjsLayer = textLayer(pdfjsText);
    if (pdfjsLayer === "READABLE" && readableWordCount(pdfjsText) >= readableWordCount(sync.text)) {
      return { ...sync, text: pdfjsText, layer: "READABLE", engine: "pdfjs", pdfjs: "read" };
    }
    return {
      ...sync,
      pdfjs: pdfjsLayer === "EMPTY" ? "empty" : "unreadable",
    };
  } catch {
    return { ...sync, pdfjs: "failed" };
  }
}

function textLayer(text) {
  const trimmed = text.trim();
  if (trimmed.length < 8) {
    return "EMPTY";
  }
  const labeled = /fatura\s*(?:no|numaras)|invoice\s*(?:no|number)|tedarik[cç]i\s*[:\-]/i.test(trimmed);
  if (readableWordCount(trimmed) >= 8 || labeled) {
    return "READABLE";
  }
  return "UNREADABLE";
}

async function textFromPdfjs(data) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) ;
  const root = path.dirname(createRequire(path.join(process.cwd(), "package.json")).resolve("pdfjs-dist/package.json"));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, "legacy/build/pdf.worker.mjs")).href;
  pdfjs.setVerbosityLevel?.(pdfjs.VerbosityLevel?.ERRORS ?? 0);
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${pathToFileURL(path.join(root, "cmaps")).href}/`,
    cMapPacked: true,
    standardFontDataUrl: `${pathToFileURL(path.join(root, "standard_fonts")).href}/`,
    isEvalSupported: false,
    useWasm: false,
    disableFontFace: true,
  });
  const document = await task.promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => (typeof item.str === "string" ? item.str : ""))
          .filter(Boolean)
          .join(" "),
      );
    }
    return pages.join("\n");
  } finally {
    await document.destroy();
  }
}

function decodeStreams(bytes) {
  const raw = bytes.toString("latin1");
  const streams = [];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const dictStart = raw.lastIndexOf("<<", match.index ?? 0);
    const dict = dictStart >= 0 ? raw.slice(dictStart, match.index) : "";
    const indirectLength = /\/Length\s+\d+\s+\d+\s+R/.test(dict);
    const lengthMatch = indirectLength ? null : dict.match(/\/Length\s+(\d+)/);
    const end = lengthMatch
      ? Math.min(bytes.length, start + Number(lengthMatch[1]))
      : raw.indexOf("endstream", start);
    if (end < start) {
      continue;
    }
    const payload = bytes.subarray(start, end < 0 ? bytes.length : end);
    const inflated = dict.includes("/FlateDecode") ? inflate(payload) : null;
    const decoded = inflated ?? (dict.includes("/FlateDecode") ? null : payload);
    if (!decoded) {
      continue;
    }
    const text = decoded.toString("latin1");
    streams.push({ kind: streamKind(dict, text), text });
  }
  return streams;
}

function inflate(payload) {
  try {
    return inflateSync(payload);
  } catch {
    try {
      return inflateRawSync(payload);
    } catch {
      return null;
    }
  }
}

function streamKind(dict, text) {
  if (dict.includes("/Image") || dict.includes("/DCTDecode") || dict.includes("/JPXDecode")) {
    return "image";
  }
  if (text.includes("beginbfchar") || text.includes("beginbfrange")) {
    return "cmap";
  }
  if (
    dict.includes("/FontFile") ||
    dict.includes("/CharStrings") ||
    text.includes("/CharStrings") ||
    text.includes("endchar")
  ) {
    return "font";
  }
  if (/\bTj\b|\bTJ\b|\bBT\b/.test(text)) {
    return "content";
  }
  return "other";
}

function literalsOutsideStreams(bytes) {
  const raw = bytes.toString("latin1");
  const hidden = raw.replace(/stream\r?\n[\s\S]*?endstream/g, " ");
  return stringsFromContent(hidden, new Map());
}

function stringsFromContent(content, cmap) {
  const parts = [];
  for (const match of content.matchAll(/\((?:\\\)|\\.|[^)\\]){1,500}\)/g)) {
    const decoded = preferReadable(decodePdfLiteral(match[0].slice(1, -1)), cmap);
    if (decoded) {
      parts.push(decoded);
    }
  }
  for (const match of content.matchAll(/<([0-9A-Fa-f\s]{4,})>/g)) {
    const decoded = preferHex(match[1], cmap);
    if (decoded) {
      parts.push(decoded);
    }
  }
  return parts.join("\n");
}

function usefulText(text) {
  return (
    readableWordCount(text) > 0 ||
    /fatura|invoice|tarih|toplam|tutar|kdv|vergi|makbuz/i.test(text) ||
    /\d{4}-\d{2}-\d{2}|\d{2}[./]\d{2}[./]\d{4}/.test(text) ||
    /\d+[.,]\d{2}/.test(text) ||
    /\b(TRY|USD|EUR|TL)\b/i.test(text)
  );
}

function preferReadable(text, cmap) {
  if (usefulText(text)) {
    return text.trim();
  }
  const mapped = mapLiteral(text, cmap);
  return readableWordCount(mapped) > 0 ? mapped.trim() : "";
}

function preferHex(hex, cmap) {
  const mapped = mapHex(hex, cmap);
  const unicode = utf16Hex(hex);
  const mappedScore = readableWordCount(mapped);
  const unicodeScore = readableWordCount(unicode);
  if (mappedScore === 0 && unicodeScore === 0) {
    return "";
  }
  return mappedScore >= unicodeScore ? mapped.trim() : unicode.trim();
}

function decodePdfLiteral(raw) {
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = raw[index + 1];
    if (!next) {
      break;
    }
    if (next === "n") {
      out += "\n";
    } else if (next === "r") {
      out += "\r";
    } else if (next === "t") {
      out += "\t";
    } else if (next === "(" || next === ")" || next === "\\") {
      out += next;
    } else if (next >= "0" && next <= "7") {
      let octal = next;
      let cursor = index + 2;
      while (cursor < raw.length && cursor < index + 4 && raw[cursor] >= "0" && raw[cursor] <= "7") {
        octal += raw[cursor];
        cursor += 1;
      }
      out += String.fromCharCode(Number.parseInt(octal, 8));
      index = cursor - 1;
      continue;
    } else {
      out += next;
    }
    index += 1;
  }
  if (out.charCodeAt(0) === 0xfe && out.charCodeAt(1) === 0xff) {
    const units = [];
    for (let index = 2; index + 1 < out.length; index += 2) {
      units.push((out.charCodeAt(index) << 8) | out.charCodeAt(index + 1));
    }
    return String.fromCharCode(...units);
  }
  return out;
}

function parseCmap(cmap) {
  const map = new Map();
  for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const text = utf16Hex(pair[2]);
      if (text) {
        map.set(pair[1].toUpperCase(), text);
      }
    }
  }
  for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const dest = Number.parseInt(range[3], 16);
      if (Number.isNaN(start) || Number.isNaN(end) || end < start || end - start > 400) {
        continue;
      }
      for (let code = start; code <= end; code += 1) {
        map.set(
          code.toString(16).toUpperCase().padStart(range[1].length, "0"),
          String.fromCharCode(dest + (code - start)),
        );
      }
    }
  }
  return map;
}

function mapLiteral(value, cmap) {
  if (cmap.size === 0) {
    return "";
  }
  const width = [...cmap.keys()].reduce((longest, key) => Math.max(longest, key.length), 0);
  let out = "";
  for (const char of value) {
    out += cmap.get(char.charCodeAt(0).toString(16).toUpperCase().padStart(width, "0")) ?? "";
  }
  return out;
}

function mapHex(hex, cmap) {
  if (cmap.size === 0) {
    return "";
  }
  const clean = hex.replace(/\s+/g, "").toUpperCase();
  const width = [...cmap.keys()].reduce((longest, key) => Math.max(longest, key.length), 0);
  if (!width || clean.length % width !== 0) {
    return "";
  }
  let out = "";
  for (let index = 0; index < clean.length; index += width) {
    out += cmap.get(clean.slice(index, index + width)) ?? "";
  }
  return out;
}

function utf16Hex(hex) {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length < 4 || clean.length % 4 !== 0) {
    return "";
  }
  let out = "";
  for (let index = 0; index < clean.length; index += 4) {
    const code = Number.parseInt(clean.slice(index, index + 4), 16);
    if (!Number.isNaN(code) && code !== 0) {
      out += String.fromCharCode(code);
    }
  }
  return out;
}
