"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { attachBugFileAction, clearBugFileAction, createBugPageAction, createBugRowAction, deleteBugPageAction, deleteBugRowAction, renameBugPageAction, updateBugRowAction } from "@/app/(panel)/urunler/actions";

const COLUMNS = ["✓", "Tarih", "Hata & Bug Detayı", "Yazılım Birimi Notu", "Mağaza", "Yazan Kişi", "Dosya Eki"];

const WIDTHS = ["4%", "12%", "28%", "22%", "10%", "12%", "12%"];

const STORES = ["App Store", "Google Play", "Her ikisi"];

function cellClass(done) {
  return `w-full min-w-0 max-w-full resize-none overflow-hidden break-all border-0 bg-transparent px-1 py-0.5 text-center text-[11px] leading-4 text-[#434343] outline-none [field-sizing:content] ${done ? "line-through decoration-solid" : ""}`;
}

function shownDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-");
  return `${day}.${month}.${year}`;
}

export default function BugBoard({ pages, sheet, authors = [] }) {
  if (!sheet) {
    return <p className="text-sm text-slate-500">Sayfa bulunamadı.</p>;
  }
  return <BugSheet key={sheet.id} pages={pages} sheet={sheet} authors={authors} />;
}

function BugSheet({ pages, sheet, authors }) {
  const router = useRouter();
  const [rows, setRows] = useState(sheet.rows);
  const [name, setName] = useState(sheet.name);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(false);
  const [confirmingPage, setConfirmingPage] = useState(false);

  function replace(row) {
    setRows((current) => current.map((item) => (item.id === row.id ? row : item)));
  }

  async function addRow() {
    setPending(true);
    setNotice(null);
    const result = await createBugRowAction({ pageId: sheet.id });
    setPending(false);
    if (!result.ok) {
      setNotice({ ok: false, text: result.message });
      return;
    }
    setRows((current) => [...current, result.row]);
  }

  const blanks = Math.max(6, 10 - rows.length);

  function commitName() {
    const next = name.trim() || "Sayfa";
    setName(next);
    if (next === sheet.name) return;
    void renameBugPageAction({ pageId: sheet.id, name: next }).then((result) => {
      if (!result.ok) {
        setName(sheet.name);
        setNotice({ ok: false, text: result.message });
        return;
      }
      setName(result.page.name);
      router.refresh();
    });
  }

  function nameKey(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  }

  async function addPage() {
    setPending(true);
    const result = await createBugPageAction();
    setPending(false);
    if (!result.ok) {
      setNotice({ ok: false, text: result.message });
      return;
    }
    router.push(`/urunler?sekme=hata&sayfa=${result.page.id}`);
  }

  async function removePage() {
    setPending(true);
    setNotice(null);
    const result = await deleteBugPageAction({ pageId: sheet.id });
    setPending(false);
    setConfirmingPage(false);
    if (!result.ok) {
      setNotice({ ok: false, text: result.message });
      return;
    }
    router.push(`/urunler?sekme=hata&sayfa=${result.page.id}`);
  }

  return (
    <div className="overflow-hidden border border-[#dadce0] bg-white font-[Roboto,Arial,sans-serif] shadow-sm">
      {notice ? <p className={notice.ok ? "px-3 py-2 text-sm text-emerald-700" : "px-3 py-2 text-sm text-red-700"}>{notice.text}</p> : null}
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#674EA7] text-white">
            <th colSpan={7} className="h-11 border border-white/15 px-3 text-left">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={nameKey}
                className="w-full rounded bg-transparent px-1 text-lg font-normal text-white outline-none hover:bg-white/10 focus:bg-white/15"
                aria-label="Sayfa adı"
                title="Sayfa adını buradan değiştir"
              />
            </th>
          </tr>
          <tr className="bg-[#674EA7] text-center text-[10px] font-bold leading-tight text-white">
            {COLUMNS.map((label) => (
              <th key={label} className="border border-white/15 px-1 py-1 font-bold">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <BugRow
              key={row.id}
              row={row}
              pageId={sheet.id}
              onChange={replace}
              onRemove={(id) => setRows((current) => current.filter((item) => item.id !== id))}
              onRestore={(restored) => setRows((current) => (current.some((item) => item.id === restored.id) ? current : [...current, restored]))}
              onNotice={setNotice}
              authors={authors}
            />
          ))}
          {Array.from({ length: blanks }, (_, index) => (
            <tr key={`blank-${index}`} className={index === 0 ? "h-7 cursor-cell" : "h-7"} onClick={index === 0 && !pending ? addRow : undefined}>
              {COLUMNS.map((label) => <td key={label} className="border border-[#e6e6e6]" />)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-end gap-1 border-t border-[#dadce0] bg-[#f8f9fa] px-2 pt-1" aria-label="Sayfalar">
        {pages.map((page) => {
          const active = page.id === sheet.id;
          if (active) {
            return (
              <input
                key={page.id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={nameKey}
                aria-label="Sayfa adı"
                title="Sayfa adını yaz, Enter ile kaydet"
                style={{ width: `${Math.max(name.length, 6) + 2}ch` }}
                className="rounded-t border border-b-white border-[#674EA7] bg-white px-2 py-1 text-xs font-semibold text-slate-900 outline-none"
              />
            );
          }
          return (
            <Link
              key={page.id}
              href={`/urunler?sekme=hata&sayfa=${encodeURIComponent(page.id)}`}
              className="px-3 py-1.5 text-xs text-slate-600 no-underline hover:bg-white"
            >
              {page.name}
            </Link>
          );
        })}
        <button type="button" className="mb-1 px-2 py-1 text-xs font-semibold text-[#674EA7]" disabled={pending} onClick={addPage}>+ Sayfa</button>
        <button type="button" className="mb-1 px-2 py-1 text-xs font-semibold text-[#674EA7]" disabled={pending} onClick={addRow}>+ Satır</button>
        {confirmingPage ? (
          <span className="mb-1 flex items-center gap-1 px-2 text-xs text-slate-600">
            <span>{sheet.name} silinsin mi?</span>
            <button type="button" className="font-semibold text-red-700" disabled={pending} onClick={removePage}>Sil</button>
            <button type="button" className="text-slate-500" disabled={pending} onClick={() => setConfirmingPage(false)}>Vazgeç</button>
          </span>
        ) : (
          <button type="button" className="mb-1 px-2 py-1 text-xs font-semibold text-slate-500" disabled={pending} onClick={() => setConfirmingPage(true)}>Sayfayı sil</button>
        )}
      </div>
    </div>
  );
}

function Choice({ value, options, label, onPick, done }) {
  const current = String(value ?? "");
  const listed = options.includes(current);
  return (
    <div className="relative">
    <select
      value={current}
      onChange={(event) => onPick(event.target.value)}
      className={`w-full min-w-0 cursor-pointer appearance-none border-0 bg-transparent px-0.5 py-0.5 pr-4 text-center text-[11px] leading-4 text-[#434343] outline-none ${done ? "line-through decoration-solid" : ""}`}
      aria-label={label}
    >
      <option value="">Seç</option>
      {current && !listed ? <option value={current}>{current}</option> : null}
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
    <span className="pointer-events-none absolute top-1/2 right-0.5 -translate-y-1/2 text-[9px] text-[#434343]" aria-hidden="true">▾</span>
    </div>
  );
}

function DateCell({ value, done, onChange }) {
  const picker = useRef(null);
  return (
    <div className="flex items-center justify-center gap-1 px-1">
      <button type="button" className="shrink-0 text-[#434343]" aria-label="Tarih seç" onClick={() => picker.current?.showPicker?.()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      <span className={`min-w-0 text-[11px] leading-4 text-[#434343] ${done ? "line-through decoration-solid" : ""}`}>{shownDate(value)}</span>
      <input ref={picker} type="date" value={value} onChange={onChange} className="sr-only" aria-label="Tarih" />
    </div>
  );
}

function BugRow({ row, pageId, onChange, onRemove, onRestore, onNotice, authors }) {
  const [draft, setDraft] = useState(row);
  const [confirming, setConfirming] = useState(false);

  function edit(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function saveDate(value) {
    setDraft((current) => ({ ...current, date: value }));
    if (value === row.date) return;
    onChange({ ...row, date: value });
    void updateBugRowAction({ pageId, rowId: row.id, date: value }).then((result) => {
      if (!result.ok) {
        setDraft(row);
        onChange(row);
        onNotice({ ok: false, text: result.message });
        return;
      }
      setDraft(result.row);
      onChange(result.row);
    });
  }

  function pick(key, value) {
    if (value === row[key]) {
      setDraft((current) => ({ ...current, [key]: value }));
      return;
    }
    setDraft((current) => ({ ...current, [key]: value }));
    onChange({ ...row, [key]: value });
    void updateBugRowAction({ pageId, rowId: row.id, [key]: value }).then((result) => {
      if (!result.ok) {
        setDraft(row);
        onChange(row);
        onNotice({ ok: false, text: result.message });
        return;
      }
      setDraft(result.row);
      onChange(result.row);
    });
  }

  function commit(key) {
    if (draft[key] === row[key]) return;
    const patch = { [key]: draft[key] };
    onChange({ ...row, ...patch });
    void updateBugRowAction({ pageId, rowId: row.id, ...patch }).then((result) => {
      if (!result.ok) {
        setDraft(row);
        onChange(row);
        onNotice({ ok: false, text: result.message });
        return;
      }
      setDraft(result.row);
      onChange(result.row);
    });
  }

  function toggle(done) {
    const next = { ...draft, done };
    setDraft(next);
    onChange({ ...row, done });
    void updateBugRowAction({ pageId, rowId: row.id, done }).then((result) => {
      if (!result.ok) {
        setDraft(row);
        onChange(row);
        onNotice({ ok: false, text: result.message });
        return;
      }
      setDraft(result.row);
      onChange(result.row);
    });
  }

  async function upload(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const body = new FormData();
    body.set("pageId", pageId);
    body.set("rowId", row.id);
    body.set("file", file);
    const result = await attachBugFileAction(body);
    if (!result.ok) {
      onNotice({ ok: false, text: result.message });
      return;
    }
    setDraft(result.row);
    onChange(result.row);
    onNotice({ ok: true, text: result.message });
  }

  async function clearFile() {
    const result = await clearBugFileAction({ pageId, rowId: row.id });
    if (!result.ok) {
      onNotice({ ok: false, text: result.message });
      return;
    }
    setDraft(result.row);
    onChange(result.row);
  }

  async function remove() {
    setConfirming(false);
    onRemove(row.id);
    const result = await deleteBugRowAction({ pageId, rowId: row.id });
    if (!result.ok) {
      onRestore(row);
      onNotice({ ok: false, text: result.message });
    }
  }

  return (
    <tr className="group align-middle">
      <td className="overflow-hidden border border-[#e6e6e6] text-center">
        <input type="checkbox" checked={draft.done} onChange={(event) => toggle(event.target.checked)} aria-label="Tamamlandı" />
        {confirming ? (
          <div className="space-y-1 py-1">
            <button type="button" className="text-[11px] font-semibold text-red-700" onClick={remove}>Sil</button>
            <button type="button" className="block w-full text-[11px] text-slate-500" onClick={() => setConfirming(false)}>Vazgeç</button>
          </div>
        ) : (
          <button type="button" className="mt-1 hidden text-[11px] text-slate-400 group-hover:inline" onClick={() => setConfirming(true)}>Sil</button>
        )}
      </td>
      <td className="overflow-hidden border border-[#e6e6e6]">
        <DateCell value={draft.date} done={draft.done} onChange={(event) => saveDate(event.target.value)} />
      </td>
      <td className="overflow-hidden border border-[#e6e6e6]">
        <textarea value={draft.detail} onChange={(event) => edit("detail", event.target.value)} onBlur={() => commit("detail")} rows={1} className={cellClass(draft.done)} aria-label="Hata ve bug detayı" />
      </td>
      <td className="overflow-hidden border border-[#e6e6e6]">
        <textarea value={draft.softwareNote} onChange={(event) => edit("softwareNote", event.target.value)} onBlur={() => commit("softwareNote")} rows={1} className={cellClass(draft.done)} aria-label="Yazılım birimi notu" />
      </td>
      <td className="overflow-hidden border border-[#e6e6e6]">
        <Choice value={draft.store} options={STORES} label="Mağaza" done={draft.done} onPick={(value) => pick("store", value)} />
      </td>
      <td className="overflow-hidden border border-[#e6e6e6]">
        <Choice value={draft.author} options={authors} label="Yazan kişi" done={draft.done} onPick={(value) => pick("author", value)} />
      </td>
      <td className="overflow-hidden border border-[#e6e6e6] px-1 py-0.5 text-center">
        {draft.file ? (
          <div className="space-y-1 text-center">
            <a href={`/api/hata-dosya/${draft.file.id}`} target="_blank" rel="noopener noreferrer" className={`block break-all text-center text-xs font-semibold text-[#03624c] ${draft.done ? "line-through" : ""}`}>{draft.file.name}</a>
            <button type="button" className="text-xs text-slate-500" onClick={clearFile}>Kaldır</button>
          </div>
        ) : null}
        <label className="mt-1 inline-flex cursor-pointer rounded border border-[#674EA7] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-[#674EA7]">
          {draft.file ? "Değiştir" : "Dosya / görsel"}
          <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,image/*" onChange={upload} />
        </label>
      </td>
    </tr>
  );
}
