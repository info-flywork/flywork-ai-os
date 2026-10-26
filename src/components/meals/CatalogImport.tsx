"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import Notice from "@/components/Notice";
import { sourceFromBrowserFiles } from "@/components/meals/catalogSelection";
import { importCatalogAction, type CatalogImportState } from "@/app/(panel)/yemek-yonetimi/actions";
import { CATALOG_IMPORT_TEMPLATE } from "@/server/meals/catalogTemplate";
import { previewMatchesSource, type CatalogPreview, type CatalogSource } from "@/server/meals/importCatalog";

function downloadTemplate() {
  const blob = new Blob([`\uFEFF${CATALOG_IMPORT_TEMPLATE}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "yemek-katalogu-sablon.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function selectedFiles(list: FileList | null): File[] {
  return [...(list ?? [])].filter((file) => file.size > 0);
}

function restoreFiles(input: HTMLInputElement, files: File[]) {
  if (typeof DataTransfer === "undefined") {
    return;
  }
  const transfer = new DataTransfer();
  for (const file of files) {
    transfer.items.add(file);
  }
  input.files = transfer.files;
}

function Rows({
  title,
  rows,
}: {
  title: string;
  rows: CatalogPreview["rows"];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="text-sm font-semibold">
        {title} ({rows.length})
      </h3>
      <ul className="mt-1 max-h-80 space-y-1 overflow-y-auto text-sm text-slate-600">
        {rows.map((row) => (
          <li key={`${row.outcome}-${row.line}`}>
            Satır {row.line}: {row.name}. Kategori: {row.categoryLabel}. Grup: {row.slotLabel}. {row.message} Fiyat:{" "}
            {row.priceLabel || "yok"}.{row.description ? ` Açıklama: ${row.description}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ preview }: { preview: CatalogPreview }) {
  const items = [
    ["Yeni kayıt", preview.created],
    ["Eşleşen", preview.skipped + preview.photosAttached],
    ["Hatalı", preview.failed],
    ["Eksik fotoğraf", preview.missingPhotos],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-slate-200 px-3 py-2">
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="text-lg font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function CatalogImport() {
  const [state, action, pending] = useActionState<CatalogImportState | undefined, FormData>(
    importCatalogAction,
    undefined,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [catalogFile, setCatalogFile] = useState<File | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const requestKey = catalogFile
    ? [catalogFile, ...photoFiles].map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|")
    : "";
  const [loaded, setLoaded] = useState<{ key: string; source: CatalogSource } | null>(null);
  const source = loaded?.key === requestKey ? loaded.source : null;
  const sourceReady = !catalogFile || source !== null;
  const preview = previewMatchesSource(state?.preview, source) ? state.preview : undefined;
  const canApprove = Boolean(preview) && sourceReady && !pending;

  useEffect(() => {
    if (!catalogFile) {
      return;
    }
    let cancel = false;
    const key = requestKey;
    void sourceFromBrowserFiles(catalogFile, photoFiles).then((next) => {
      if (!cancel) {
        setLoaded({ key, source: next });
      }
    });
    return () => {
      cancel = true;
    };
  }, [catalogFile, photoFiles, requestKey]);

  useEffect(() => {
    const input = fileRef.current;
    if (!input || !catalogFile || (input.files?.length ?? 0) > 0) {
      return;
    }
    restoreFiles(input, [catalogFile]);
  }, [catalogFile, state]);

  useEffect(() => {
    const input = photoRef.current;
    if (!input || photoFiles.length === 0 || (input.files?.length ?? 0) > 0) {
      return;
    }
    restoreFiles(input, photoFiles);
  }, [photoFiles, state]);

  function onCatalogChange(event: FormEvent<HTMLInputElement>) {
    const file = selectedFiles(event.currentTarget.files)[0] ?? null;
    setCatalogFile(file);
  }

  function onPhotoChange(event: FormEvent<HTMLInputElement>) {
    setPhotoFiles(selectedFiles(event.currentTarget.files));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name === "onay" && !canApprove) {
      return;
    }
    const data = new FormData(event.currentTarget);
    if (catalogFile) {
      data.set("dosya", catalogFile);
    }
    data.delete("fotograflar");
    for (const photo of photoFiles) {
      data.append("fotograflar", photo);
    }
    if (submitter instanceof HTMLButtonElement && submitter.name) {
      data.set(submitter.name, submitter.value);
    }
    startTransition(() => {
      action(data);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-slate-200 pt-4">
      <h3 className="section-title">Katalog aktarımı</h3>
      <p className="text-sm text-slate-600">
        CSV veya JSON yükleyin. Fotoğraf sütununa dosya adını yazın ve aynı dosyaları aşağıdan seçin.
        Sunucudaki klasör yolları ve internet adresleri okunmaz. Önizleme kayıt yazmaz.
      </p>
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <fieldset disabled={pending} className="space-y-3">
        <button type="button" className="btn-secondary" onClick={downloadTemplate}>
          CSV şablonunu indir
        </button>
        <label className="block text-sm" htmlFor="catalog-file">
          Katalog dosyası
        </label>
        <input
          ref={fileRef}
          id="catalog-file"
          name="dosya"
          type="file"
          required
          accept=".csv,.json,text/csv,application/json"
          className="field"
          onChange={onCatalogChange}
        />
        <p className="text-sm text-slate-700">
          {catalogFile ? `Seçilen dosya: ${catalogFile.name}` : "Katalog dosyası seçilmedi."}
        </p>
        {catalogFile ? (
          <button
            type="button"
            className="text-sm font-medium text-slate-600 underline"
            onClick={() => {
              if (fileRef.current) {
                fileRef.current.value = "";
              }
              setCatalogFile(null);
            }}
          >
            Dosya seçimini kaldır
          </button>
        ) : null}
        <label className="block text-sm" htmlFor="catalog-photos">
          Fotoğraflar
        </label>
        <input
          ref={photoRef}
          id="catalog-photos"
          name="fotograflar"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="field"
          onChange={onPhotoChange}
        />
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">Önizleme seçilen dosyaya ait: {preview.source.fileName}. Kayıt yazılmadı.</p>
            <Summary preview={preview} />
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            {catalogFile ? "Bu dosya için güncel önizleme yok. Önizlemeyi gösterin." : "Onay, dosya seçilip önizleme hazırlanınca açılır."}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-secondary" type="submit">
            {pending ? "Hazırlanıyor…" : "Önizlemeyi göster"}
          </button>
          <button
            className="btn-primary"
            type="submit"
            name="onay"
            value="on"
            disabled={!canApprove}
            style={canApprove ? undefined : { background: "#e2e8f0", color: "#64748b", cursor: "not-allowed" }}
          >
            İçe aktarmayı onayla
          </button>
        </div>
      </fieldset>
      {preview ? (
        <div className="space-y-3">
          <Rows title="Yeni kayıtlar" rows={preview.rows.filter((row) => row.outcome === "create")} />
          <Rows
            title="Eşleşenler"
            rows={preview.rows.filter((row) => row.outcome === "skip" || row.outcome === "attach-photo")}
          />
          <Rows title="Hatalı satırlar" rows={preview.rows.filter((row) => row.outcome === "error")} />
          <Rows title="Eksik fotoğraflar" rows={preview.rows.filter((row) => row.missingPhoto)} />
        </div>
      ) : null}
    </form>
  );
}
