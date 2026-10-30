"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Folder, FolderPlus, FolderUp, Trash2 } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { createFolderAction, deleteEntryAction, deleteFigmaLinkAction, prepareFolderImportAction, saveFigmaLinkAction, updateFigmaLinkAction, uploadProductFilesAction } from "@/app/(panel)/urunler/actions";

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif";
const ALLOWED = new Set(ACCEPT.split(",").map((ext) => ext.slice(1)));

const TABS = [
  ["uygulamalar", "Uygulamalar", "/urunler"],
  ["oyunlar", "Oyunlar", "/urunler?sekme=oyunlar"],
  ["aso", "ASO Metinleri", "/urunler?sekme=aso"],
  ["analiz", "Ürün Analizleri", "/urunler?sekme=analiz"],
  ["figma", "Tasarımlar", "/urunler?sekme=figma"],
];

const FIGMA_AREAS = [
  ["flow", "User Flow", "/urunler?sekme=figma"],
  ["design", "Design", "/urunler?sekme=figma&alan=design"],
];

function matchesKind(product, kind) {
  if (kind === "oyunlar") return product.kind === "game";
  if (kind === "aso") return product.kind === "aso";
  if (kind === "analiz") return product.kind === "analiz";
  return product.kind !== "game" && product.kind !== "aso" && product.kind !== "analiz";
}

function folderParts(folder) {
  return folder ? folder.split(" / ").filter(Boolean) : [];
}

function listLevel(files, folderPaths, segments) {
  const folders = new Map();
  const here = [];
  function addFolder(parts, countFile) {
    const inside = segments.every((segment, index) => parts[index] === segment);
    if (!inside || parts.length <= segments.length) return;
    const name = parts[segments.length];
    const current = folders.get(name) ?? { name, files: 0, folders: new Set() };
    if (countFile && parts.length === segments.length + 1) current.files += 1;
    if (parts.length > segments.length + 1) current.folders.add(parts[segments.length + 1]);
    folders.set(name, current);
  }
  for (const file of files) {
    const parts = folderParts(file.folder);
    const inside = segments.every((segment, index) => parts[index] === segment);
    if (!inside || parts.length < segments.length) continue;
    if (parts.length === segments.length) here.push(file);
    else addFolder(parts, true);
  }
  for (const folderPath of folderPaths) addFolder(folderParts(folderPath), false);
  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, "tr")),
    files: here.sort((a, b) => a.name.localeCompare(b.name, "tr")),
  };
}

function rootHint(product) {
  const folders = new Set([
    ...product.files.map((file) => folderParts(file.folder)[0]),
    ...(product.folders ?? []).map((folder) => folderParts(folder)[0]),
  ].filter(Boolean));
  const loose = product.files.filter((file) => !file.folder).length;
  const bits = [];
  if (folders.size) bits.push(`${folders.size} klasör`);
  if (loose) bits.push(`${loose} dosya`);
  if (!bits.length) bits.push(product.files.length ? `${product.files.length} dosya` : "Boş");
  return bits.join(" · ");
}

function folderHint(folder) {
  const bits = [];
  if (folder.folders.size) bits.push(`${folder.folders.size} klasör`);
  if (folder.files) bits.push(`${folder.files} dosya`);
  return bits.join(" · ") || "Boş";
}

export default function ProductLibrary({ products, kind, area = "flow", figmaLinks = [], figmaApps = [] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [trail, setTrail] = useState([]);
  const [naming, setNaming] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const rootLabel = TABS.find(([id]) => id === kind)?.[1] ?? "Uygulamalar";
  const inKind = products.filter((product) => matchesKind(product, kind));

  useEffect(() => {
    setTrail([]);
    setQuery("");
    setNaming(false);
    setFolderName("");
    setNotice(null);
    setPendingDelete(null);
  }, [kind]);
  const product = inKind.find((item) => item.id === trail[0]) ?? null;
  const segments = product ? trail.slice(1) : [];
  const level = product ? listLevel(product.files, product.folders ?? [], segments) : null;
  const needle = query.trim().toLocaleLowerCase("tr");

  const results = useMemo(() => {
    if (!needle) return null;
    const found = [];
    for (const item of inKind) {
      if (item.name.toLocaleLowerCase("tr").includes(needle)) {
        found.push({ key: `product:${item.id}`, type: "folder", label: item.name, hint: rootLabel, trail: [item.id] });
      }
      const seen = new Set();
      for (const file of item.files) {
        const parts = folderParts(file.folder);
        parts.forEach((part, index) => {
          const key = `${item.id}/${parts.slice(0, index + 1).join("/")}`;
          if (seen.has(key) || !part.toLocaleLowerCase("tr").includes(needle)) return;
          seen.add(key);
          found.push({
            key,
            type: "folder",
            label: part,
            hint: [item.name, ...parts.slice(0, index)].join(" / "),
            trail: [item.id, ...parts.slice(0, index + 1)],
          });
        });
        if (file.name.toLocaleLowerCase("tr").includes(needle)) {
          found.push({
            key: file.url,
            type: "file",
            label: file.name,
            hint: [item.name, file.folder].filter(Boolean).join(" / "),
            productId: item.id,
            file,
          });
        }
      }
      for (const folder of item.folders ?? []) {
        const parts = folderParts(folder);
        parts.forEach((part, index) => {
          const key = `${item.id}/${parts.slice(0, index + 1).join("/")}`;
          if (seen.has(key) || !part.toLocaleLowerCase("tr").includes(needle)) return;
          seen.add(key);
          found.push({
            key,
            type: "folder",
            label: part,
            hint: [item.name, ...parts.slice(0, index)].join(" / "),
            trail: [item.id, ...parts.slice(0, index + 1)],
          });
        });
      }
    }
    return found;
  }, [inKind, needle, rootLabel]);

  const crumbs = product ? [product.name, ...segments] : [];

  function openTrail(next) {
    setQuery("");
    setTrail(next);
  }

  async function createFolder(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await createFolderAction({
      kind,
      productId: product?.id ?? null,
      segments,
      name: folderName,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ ok: false, text: result.message });
      return;
    }
    setFolderName("");
    setNaming(false);
    setQuery("");
    setNotice({ ok: true, text: result.message });
    if (!product && result.id) setTrail([result.id]);
    router.refresh();
  }

  async function uploadFiles(event) {
    const input = event.target;
    const selected = [...input.files];
    input.value = "";
    if (!product || selected.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    const body = new FormData();
    body.set("kind", kind);
    body.set("productId", product.id);
    body.set("segments", JSON.stringify(segments));
    for (const file of selected) body.append("file", file);
    const result = await uploadProductFilesAction(body);
    setBusy(false);
    setNotice({ ok: result.ok, text: result.message });
    if (result.ok) router.refresh();
  }

  async function uploadFolder(event) {
    const input = event.target;
    const selected = [...input.files];
    input.value = "";
    if (selected.length === 0 || busy) return;
    const entries = [];
    for (const file of selected) {
      const parts = String(file.webkitRelativePath || "").split(/[/\\]/).filter(Boolean);
      if (parts.length < 2) continue;
      if (parts.some((part) => part.startsWith(".") || part === "__MACOSX")) continue;
      const ext = parts.at(-1).split(".").pop()?.toLocaleLowerCase("tr") ?? "";
      if (!ALLOWED.has(ext)) continue;
      entries.push({ file, parts });
    }
    if (entries.length === 0) {
      setNotice({ ok: false, text: "Klasörde desteklenen dosya yok. PDF, Word, Excel, PowerPoint veya fotoğraf yükleyin." });
      return;
    }
    if (entries.length > 200) {
      setNotice({ ok: false, text: "Bir klasörde en fazla 200 dosya yüklenebilir." });
      return;
    }
    setBusy(true);
    setNotice(null);
    const nested = new Set();
    for (const entry of entries) {
      const dirs = entry.parts.slice(1, -1);
      for (let depth = 1; depth <= dirs.length; depth += 1) nested.add(dirs.slice(0, depth).join(" / "));
    }
    const prepared = await prepareFolderImportAction({
      kind,
      productId: product?.id ?? null,
      segments,
      rootName: entries[0].parts[0],
      nested: [...nested],
    });
    if (!prepared.ok) {
      setBusy(false);
      setNotice({ ok: false, text: prepared.message });
      return;
    }
    const baseSegments = product ? [...segments, prepared.name] : [];
    const groups = new Map();
    for (const entry of entries) {
      const key = entry.parts.slice(1, -1).join(" / ");
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    let added = 0;
    const rejected = [];
    for (const [key, group] of groups) {
      const folderParts = key ? key.split(" / ") : [];
      let batch = [];
      let size = 0;
      const batches = [];
      for (const entry of group) {
        if (batch.length === 8 || (batch.length > 0 && size + entry.file.size > 16 * 1024 * 1024)) {
          batches.push(batch);
          batch = [];
          size = 0;
        }
        batch.push(entry);
        size += entry.file.size;
      }
      if (batch.length) batches.push(batch);
      for (const files of batches) {
        const body = new FormData();
        body.set("kind", kind);
        body.set("productId", prepared.id);
        body.set("segments", JSON.stringify([...baseSegments, ...folderParts]));
        for (const entry of files) body.append("file", entry.file);
        const result = await uploadProductFilesAction(body);
        if (!result.ok) {
          setBusy(false);
          setNotice({ ok: false, text: result.message });
          router.refresh();
          return;
        }
        if (result.message === "Dosya eklendi.") added += 1;
        else {
          const count = Number(result.message.match(/^(\d+) dosya/)?.[1] ?? 0);
          added += count;
          const skipped = result.message.split("Kabul edilmedi: ")[1];
          if (skipped) rejected.push(skipped);
        }
      }
    }
    setBusy(false);
    setNotice({
      ok: true,
      text: rejected.length ? `${added} dosya eklendi. Kabul edilmedi: ${rejected.join(", ")}` : added === 1 ? "Dosya eklendi." : `${added} dosya eklendi.`,
    });
    if (product) setTrail([product.id, ...segments, prepared.name]);
    else setTrail([prepared.id]);
    router.refresh();
  }

  function askDelete(target) {
    setNotice(null);
    setPendingDelete(target);
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    const target = pendingDelete;
    const result = await deleteEntryAction({
      kind,
      productId: target.productId,
      segments: target.segments ?? [],
      fileUrl: target.fileUrl ?? "",
    });
    setBusy(false);
    setPendingDelete(null);
    setNotice({ ok: result.ok, text: result.message });
    if (!result.ok) return;
    if (target.folder) {
      const removed = [target.productId, ...(target.segments ?? [])];
      if (removed.every((part, index) => trail[index] === part)) setTrail(removed.slice(0, -1));
    }
    router.refresh();
  }

  return (
    <div className={kind === "analiz" ? "flex h-[calc(100dvh-2rem)] flex-col gap-4" : "space-y-5"}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">Ürünler</h1>
        {kind !== "analiz" && kind !== "figma" ? (
          <div className="flex flex-wrap items-center gap-2">
            {inKind.length > 0 ? (
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="field w-56"
                placeholder="Klasör veya dosya ara"
                aria-label="Klasör veya dosya ara"
              />
            ) : null}
            <button type="button" className="btn-secondary gap-1.5" disabled={busy} onClick={() => { setNaming(true); setNotice(null); }}>
              <FolderPlus size={16} aria-hidden="true" />
              Yeni klasör
            </button>
            <label className={`btn-secondary cursor-pointer gap-1.5 ${busy ? "pointer-events-none opacity-60" : ""}`}>
              <FolderUp size={16} aria-hidden="true" />
              Klasör yükle
              <input type="file" className="sr-only" multiple disabled={busy} onChange={uploadFolder} {...{ webkitdirectory: "", directory: "" }} />
            </label>
            {product ? (
              <label className={`btn-secondary cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
                Dosya yükle
                <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={busy} onChange={uploadFiles} />
              </label>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label, href]) => (
          <Link key={id} href={href} className={id === kind ? "btn-primary" : "btn-secondary"}>
            {label}
          </Link>
        ))}
      </div>
      {kind === "analiz" ? (
        <AppPanelFrame />
      ) : kind === "figma" ? (
        <FigmaBoard area={area} links={figmaLinks} apps={figmaApps} />
      ) : (
        <>
      {naming ? (
        <form onSubmit={createFolder} className="flex flex-wrap items-center gap-2">
          <input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            className="field w-64"
            placeholder="Klasör adı"
            aria-label="Klasör adı"
            autoFocus
            disabled={busy}
          />
          <button type="submit" className="btn-primary" disabled={busy}>Oluştur</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setNaming(false); setFolderName(""); }}>Vazgeç</button>
        </form>
      ) : null}
      {notice ? <p className={notice.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{notice.text}</p> : null}
      {pendingDelete ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{pendingDelete.folder ? `${pendingDelete.label} klasörü ve içindekiler silinsin mi?` : `${pendingDelete.label} silinsin mi?`}</span>
          <button type="button" className="btn-secondary text-red-700" disabled={busy} onClick={confirmDelete}>Sil</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPendingDelete(null)}>Vazgeç</button>
        </div>
      ) : null}
      <p className="text-xs text-slate-500">Dosya veya klasör yükleyebilirsiniz. PDF, Word, Excel, PowerPoint ve fotoğraf kabul edilir. Dosya başına 20 MB.</p>
      {results ? (
        results.length === 0 ? (
          <EmptyState title="Eşleşen öğe yok" body="Aramayı değiştirince liste yeniden gelir." />
        ) : (
          <DriveGrid>
            {results.map((item) =>
              item.type === "file" ? (
                <FileTile key={item.key} file={item.file} hint={item.hint} onDelete={() => askDelete({ label: item.file.name, folder: false, productId: item.productId, fileUrl: item.file.url })} />
              ) : (
                <FolderTile
                  key={item.key}
                  name={item.label}
                  hint={item.hint}
                  onOpen={() => openTrail(item.trail)}
                  onDelete={() => askDelete({ label: item.label, folder: true, productId: item.trail[0], segments: item.trail.slice(1) })}
                />
              ),
            )}
          </DriveGrid>
        )
      ) : (
        <>
          <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Klasör yolu">
            <button
              type="button"
              onClick={() => setTrail([])}
              className={crumbs.length ? "font-medium text-[#03624c] hover:underline" : "font-semibold text-slate-900"}
            >
              {rootLabel}
            </button>
            {crumbs.map((crumb, index) => {
              const current = index === crumbs.length - 1;
              return (
                <span key={`${crumb}-${index}`} className="flex items-center gap-1">
                  <ChevronRight size={14} className="text-slate-400" />
                  {current ? (
                    <span className="font-semibold text-slate-900">{crumb}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTrail([product.id, ...segments.slice(0, index)])}
                      className="font-medium text-[#03624c] hover:underline"
                    >
                      {crumb}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
          {!product ? (
            inKind.length === 0 ? (
              <p className="text-sm text-slate-500">Henüz klasör yok.</p>
            ) : (
              <DriveGrid>
                {inKind.map((item) => (
                  <FolderTile
                    key={item.id}
                    name={item.name}
                    hint={rootHint(item)}
                    onOpen={() => setTrail([item.id])}
                    onDelete={() => askDelete({ label: item.name, folder: true, productId: item.id, segments: [] })}
                  />
                ))}
              </DriveGrid>
            )
          ) : level.folders.length === 0 && level.files.length === 0 ? (
            <p className="text-sm text-slate-500">Bu klasör boş.</p>
          ) : (
            <DriveGrid>
              {level.folders.map((folder) => (
                <FolderTile
                  key={folder.name}
                  name={folder.name}
                  hint={folderHint(folder)}
                  onOpen={() => setTrail([product.id, ...segments, folder.name])}
                  onDelete={() => askDelete({ label: folder.name, folder: true, productId: product.id, segments: [...segments, folder.name] })}
                />
              ))}
              {level.files.map((file) => (
                <FileTile key={file.url} file={file} onDelete={() => askDelete({ label: file.name, folder: false, productId: product.id, fileUrl: file.url })} />
              ))}
            </DriveGrid>
          )}
        </>
      )}
        </>
      )}
    </div>
  );
}

function AppPanelFrame() {
  const [src, setSrc] = useState("");

  useEffect(() => {
    const port = window.location.port || "3000";
    setSrc(`http://apppanel.localhost:${port}/panel`);
  }, []);

  if (!src) return <div className="min-h-0 w-full flex-1 rounded-2xl border border-slate-200 bg-white" />;

  return (
    <iframe
      title="App Panel"
      src={src}
      className="min-h-0 w-full flex-1 rounded-2xl border border-slate-200 bg-white"
    />
  );
}

function DriveGrid({ children }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{children}</div>;
}

function FolderTile({ name, hint, onOpen, onDelete }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:border-[#03624c]/40">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
          <Folder size={18} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{hint}</span>
        </span>
      </button>
      <button type="button" onClick={onDelete} aria-label={`${name} klasörünü sil`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function fileKind(name) {
  const ext = String(name ?? "").split(".").pop()?.toLocaleLowerCase("tr") ?? "";
  if (ext === "doc" || ext === "docx") return { label: "Word", mark: "W", tile: "bg-blue-50", color: "#2B579A" };
  if (ext === "xls" || ext === "xlsx" || ext === "xlsm") return { label: "Excel", mark: "X", tile: "bg-emerald-50", color: "#217346" };
  if (ext === "csv") return { label: "CSV", mark: "X", tile: "bg-emerald-50", color: "#217346" };
  if (ext === "ppt" || ext === "pptx") return { label: "PowerPoint", mark: "P", tile: "bg-orange-50", color: "#D24726" };
  if (ext === "pdf") return { label: "PDF", mark: "PDF", tile: "bg-red-50", color: "#E5252A" };
  return { label: ext ? ext.toLocaleUpperCase("tr") : "Dosya", mark: "•", tile: "bg-slate-50", color: "#64748b" };
}

function TypeIcon({ kind }) {
  return (
    <svg viewBox="0 0 48 58" className="h-16 w-14" aria-hidden="true">
      <path d="M6 4h24l12 12v36a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill={kind.color} />
      <path d="M30 4v12h12" fill="#ffffff" fillOpacity="0.45" />
      <text x="22" y="40" textAnchor="middle" fill="#ffffff" fontSize={kind.mark.length > 1 ? 13 : 20} fontWeight="700" fontFamily="ui-sans-serif, system-ui, sans-serif">
        {kind.mark}
      </text>
    </svg>
  );
}

function FileTile({ file, hint, onDelete }) {
  const kind = file.image ? null : fileKind(file.name);
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:border-[#03624c]/40">
      <a href={file.url} target="_blank" rel="noreferrer" className="block pr-8">
        {file.image ? (
          <img src={file.url} alt="" className="mb-2 h-24 w-full rounded-lg bg-slate-50 object-contain" />
        ) : (
          <span className={`mb-2 grid h-24 w-full place-items-center rounded-lg ${kind.tile}`}>
            <TypeIcon kind={kind} />
          </span>
        )}
        <span className="block truncate text-sm font-medium text-slate-900">{file.name}</span>
        {kind ? <span className="mt-0.5 block truncate text-xs font-semibold" style={{ color: kind.color }}>{kind.label}</span> : null}
        {hint ? <span className="mt-0.5 block truncate text-xs text-slate-500">{hint}</span> : null}
      </a>
      <button type="button" onClick={onDelete} aria-label={`${file.name} dosyasını sil`} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-white/90 text-slate-400 hover:bg-red-50 hover:text-red-700">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function FigmaLinkRow({ link, busy, confirming, onConfirm, onCancel, onRemove, onNotice, onSaved }) {
  const [name, setName] = useState(link.name);
  const [url, setUrl] = useState(link.url);
  const [saving, setSaving] = useState(false);
  const dirty = name !== link.name || url !== link.url;

  useEffect(() => {
    setName(link.name);
    setUrl(link.url);
  }, [link.name, link.url]);

  async function save(event) {
    event.preventDefault();
    if (saving || busy || !dirty) return;
    setSaving(true);
    const result = await updateFigmaLinkAction({ id: link.id, name, url });
    setSaving(false);
    onNotice({ ok: result.ok, text: result.message });
    if (result.ok) onSaved();
  }

  return (
    <form onSubmit={save} className="grid grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
      <input
        list="figma-apps"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="field text-left"
        aria-label={`${link.name} adı`}
        disabled={busy || saving || confirming}
      />
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        className="field text-left"
        aria-label={`${link.name} linki`}
        disabled={busy || saving || confirming}
      />
      <div className="flex items-center justify-end gap-1">
        {confirming ? (
          <>
            <button type="button" className="btn-secondary text-red-700" disabled={busy || saving} onClick={onRemove}>Sil</button>
            <button type="button" className="btn-secondary" disabled={busy || saving} onClick={onCancel}>Vazgeç</button>
          </>
        ) : (
          <>
            {dirty ? <button type="submit" className="btn-primary" disabled={busy || saving}>Kaydet</button> : null}
            <button type="button" onClick={onConfirm} aria-label={`${link.name} linkini sil`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700">
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function FigmaBoard({ area, links, apps }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingId, setPendingId] = useState("");
  const shown = links.filter((link) => link.area === area);

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await saveFigmaLinkAction({ area, name, url });
    setBusy(false);
    setNotice({ ok: result.ok, text: result.message });
    if (!result.ok) return;
    setName("");
    setUrl("");
    router.refresh();
  }

  async function remove(id) {
    if (busy) return;
    setBusy(true);
    const result = await deleteFigmaLinkAction({ id });
    setBusy(false);
    setPendingId("");
    setNotice({ ok: result.ok, text: result.message });
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FIGMA_AREAS.map(([id, label, href]) => (
          <Link key={id} href={href} className={id === area ? "btn-primary" : "btn-secondary"}>
            {label}
          </Link>
        ))}
      </div>
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Uygulama</span>
          <input
            list="figma-apps"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="field w-56"
            placeholder="Uygulama adı"
            aria-label="Uygulama"
            disabled={busy}
          />
          <datalist id="figma-apps">
            {apps.map((app) => <option key={app} value={app} />)}
          </datalist>
        </label>
        <label className="block min-w-[16rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Figma linki</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="field"
            placeholder="https://www.figma.com/design/..."
            aria-label="Figma linki"
            disabled={busy}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>Kaydet</button>
      </form>
      {notice ? <p className={notice.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{notice.text}</p> : null}
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">Bu bölümde henüz link yok.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {shown.map((link) => (
            <FigmaLinkRow
              key={link.id}
              link={link}
              busy={busy}
              confirming={pendingId === link.id}
              onConfirm={() => setPendingId(link.id)}
              onCancel={() => setPendingId("")}
              onRemove={() => remove(link.id)}
              onNotice={setNotice}
              onSaved={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
