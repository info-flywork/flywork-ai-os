"use client";

import { startTransition, useActionState, useState } from "react";
import Notice from "@/components/Notice";
import StatusBadge from "@/components/ui/StatusBadge";
import { decidePhotoReviewAction } from "@/app/(panel)/yemek-yonetimi/actions";


const FILTERS = [
  ["hepsi", "Tümü"],
  ["kesin", "Kesin"],
  ["manuel", "Manuel"],
  ["yok", "Görseli yok"],
] ;



const STATUS_LABEL = {
  kesin: "Kesin eşleşme",
  manuel: "Manuel kontrol",
  yok: "Görsel yok",
} ;

function confidenceTone(status) {
  if (status === "kesin") {
    return "ok" ;
  }
  if (status === "manuel") {
    return "warn" ;
  }
  return "neutral" ;
}

export default function PhotoReview({ view }) {
  const [filter, setFilter] = useState("hepsi");
  const [state, action, pending] = useActionState(decidePhotoReviewAction, undefined);
  const rows = view.rows.filter((row) => filter === "hepsi" || row.status === filter);

  function onSubmit(event) {
    event.preventDefault();
    const submitter = (event.nativeEvent ).submitter;
    const data = new FormData(event.currentTarget);
    if (submitter instanceof HTMLButtonElement && submitter.name) {
      data.set(submitter.name, submitter.value);
    }
    startTransition(() => action(data));
  }

  return (
    <section className="space-y-4">
      <header className="panel-card">
        <h2 className="section-title">Fotoğraf incelemesi</h2>
        <p className="mt-2 text-sm text-slate-600">
          {view.summary.examined} yemek incelendi. Resmi sitede {view.summary.products} ürün ve {view.summary.images} farklı görsel adresi var.
          Kesin eşleşme {view.summary.kesin}. Manuel kontrol {view.summary.manuel}. Görseli bulunamayan {view.summary.missing}.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Kaynak site: <a className="underline" href={view.sourceSite}>{view.sourceSite}</a>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Menü: <a className="underline" href={view.menuSite}>{view.menuSite}</a>
        </p>
        <p className="mt-2 text-sm text-amber-800">{view.rightsNote}</p>
        <p className="mt-1 text-sm text-slate-600">{view.representativeNote} Görseller bu ekranda kaynak adresinden gösterilir. Panele kopyalanmaz ve boyutu değiştirilmez.</p>
        <p className="mt-2 text-sm text-slate-700">
          Katalogda {view.catalogDishes} yemek kaydı var. Kimliğe bağlı kesin eşleşme {view.photoLinks.confirmed}, manuel liste {view.photoLinks.manual}, eksik liste {view.photoLinks.missing}.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Kesin", view.summary.kesin],
            ["Manuel", view.summary.manuel],
            ["Görseli yok", view.summary.missing],
            ["Ürün görseli", view.summary.images],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <div className="flex gap-2 overflow-x-auto">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={id === filter ? "btn-primary shrink-0" : "btn-secondary shrink-0"}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row) => {
          return (
            <article key={row.dishKey} className="panel-card flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{row.dishName}</h3>
                <StatusBadge tone={confidenceTone(row.status)}>{STATUS_LABEL[row.status]}</StatusBadge>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="warn">İzin doğrulanmadı</StatusBadge>
                {row.decision === "APPROVED" ? <StatusBadge tone="ok">Eşleşme onaylandı</StatusBadge> : null}
                {row.decision === "REJECTED" ? <StatusBadge tone="bad">Eşleşme reddedildi</StatusBadge> : null}
              </div>
              <p className="text-sm text-slate-600">{row.reason}</p>
              {row.candidates.length > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {row.candidates.map((candidate) => (
                    <div key={candidate.pageUrl} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {/* Kaynak adresinden gösterilir. next/image dosyayı panele kopyalardı. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={candidate.imageUrl}
                        alt={candidate.name}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      <p className="break-all px-3 py-2 text-xs text-slate-500">
                        {candidate.name}
                        <br />
                        <a className="underline" href={candidate.pageUrl}>{candidate.pageUrl}</a>
                        <br />
                        <a className="underline" href={candidate.imageUrl}>{candidate.imageUrl}</a>
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600">Herkese açık menüde görsel adayı yok.</p>
              )}
              <form onSubmit={onSubmit} className="mt-auto flex flex-col gap-2 sm:flex-row">
                <input type="hidden" name="dishKey" value={row.dishKey} />
                <button
                  className="btn-primary"
                  type="submit"
                  name="decision"
                  value="APPROVED"
                  disabled={pending || row.candidates.length !== 1}
                >
                  Onayla
                </button>
                <button className="btn-secondary" type="submit" name="decision" value="REJECTED" disabled={pending}>
                  Reddet
                </button>
              </form>
            </article>
          );
        })}
      </div>
    </section>
  );
}
