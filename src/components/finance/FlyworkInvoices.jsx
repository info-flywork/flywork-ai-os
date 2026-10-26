"use client";

import { useActionState, useRef, useState } from "react";
import Notice from "@/components/Notice";
import { importFlyworkInvoiceAction } from "@/app/(panel)/harcama/actions";
import { withAllCurrencies } from "@/server/finance/cards";















const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];



function formatMoney(amount, currency) {
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return `${formatted} ${currency === "TRY" ? "TL" : currency}`;
}

function monthLabel(month) {
  const [year, monthNumber] = month.split("-");
  return `${MONTHS[Number(monthNumber) - 1] ?? month} ${year}`;
}

function CurrencyCard({ label, rows }) {
  const lines = withAllCurrencies(rows);
  return (
    <article className="panel-card min-w-0">
      <p className="text-sm text-slate-500">{label}</p>
      <ul className="mt-3 space-y-1">
        {lines.map((row, index) => (
          <li
            key={row.currency}
            className={index === 0 ? "text-lg font-semibold tracking-tight text-slate-900 sm:text-2xl" : "text-xs font-medium text-slate-700 sm:text-sm"}
          >
            {formatMoney(row.total, row.currency)}
            {row.count > 0 ? <span className="ml-2 text-sm font-normal text-slate-400">{row.count} kayıt</span> : null}
          </li>
        ))}
      </ul>
    </article>
  );
}

function formatDate(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

const COLUMNS = [
  "Tarih",
  "Tedarikçi",
  "Öğe açıklaması",
  "Adet",
  "Miktar (TL)",
  "Miktar (USD)",
  "Miktar (EUR)",
  "Ödeme türü",
  "Ödeme Yapılan Kart",
  "Harcamayı Yapan Kişi",
  "Fatura",
] ;

function moneyCell(invoice, currency) {
  if (invoice.currency !== currency) return "";
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(invoice.amount));
  return `${formatted} ${currency === "TRY" ? "TL" : currency}`;
}

export default function FlyworkInvoices({
  todayLabel,
  month,
  invoices,
  cards,
  transfers,
  totals,
}






) {
  const [state, action, pending] = useActionState(importFlyworkInvoiceAction, null);
  const fileInput = useRef(null);
  const [fileName, setFileName] = useState(null);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-400">FLYWORK / ÇALIŞMA ALANI</p>
          <h1 className="page-title mt-2">Flywork Faturaları</h1>
        </div>
        <p className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{todayLabel}</p>
      </header>

      <section>
        <h2 className="section-title">Bu ay kart bazında</h2>
        <p className="mb-3 text-sm text-slate-500">{monthLabel(month)} · Flywork harcamaları</p>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {cards.map((card) => (
            <CurrencyCard key={card.label} label={card.label} rows={card.byCurrency} />
          ))}
          <CurrencyCard label="Banka havalesi" rows={transfers} />
          <CurrencyCard label="Toplam harcama" rows={totals} />
        </div>
      </section>

      <section className="panel-card w-fit max-w-full" style={{ padding: "0.7rem 0.85rem" }}>
        <form method="get" action="/harcama" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="sekme" value="flywork" />
          <label className="w-52 text-sm">
            Seçili ay
            <input
              type="month"
              name="ay"
              defaultValue={month}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              className="field mt-1"
            />
          </label>
          <a className="btn-primary" href={`/api/fatura-excel?ay=${encodeURIComponent(month)}&alan=flywork`}>
            Exceli indir
          </a>
          <a className="btn-secondary" href={`/api/fatura-paketi?ay=${encodeURIComponent(month)}&alan=flywork`}>
            Faturaları indir
          </a>
        </form>
      </section>

      <form action={action} className="panel-card">
        <h2 className="section-title">Fatura ekle</h2>
        {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
        <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="invoice-file" className="btn-secondary cursor-pointer">Dosya seç</label>
            <input
              ref={fileInput}
              id="invoice-file"
              name="belge"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const nextName = event.currentTarget.files?.[0]?.name ?? null;
                setFileName(nextName);
                if (nextName) event.currentTarget.form?.requestSubmit();
              }}
            />
            <p className="min-w-0 text-sm text-slate-600">
              {pending ? "Taranıyor…" : fileName ? <span className="font-medium text-slate-900">{fileName}</span> : "Henüz dosya seçilmedi"}
              <span className="mt-1 block text-xs text-slate-500">PDF, JPG, PNG veya WEBP. En fazla 8 MB. Dosya taranır ve Flywork harcamalarına eklenir.</span>
            </p>
            {fileName ? (
              <button
                type="button"
                className="text-sm font-semibold text-slate-600 underline"
                onClick={() => {
                  setFileName(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                Kaldır
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <table className="w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[7.5%]" />
            <col className="w-[9%]" />
            <col className="w-[16%]" />
            <col className="w-[4%]" />
            <col className="w-[9%]" />
            <col className="w-[8.5%]" />
            <col className="w-[8.5%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[9.5%]" />
          </colgroup>
          <thead>
            <tr className="bg-[#5f7f99] text-white">
              {COLUMNS.map((column) => (
                <th key={column} className="border border-white/30 px-1.5 py-2 font-semibold leading-tight">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="border border-slate-200 px-1.5 py-6 text-center text-slate-500">
                  Bu dönemde Flywork faturası yok.
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="border border-slate-200 px-1.5 py-2">{formatDate(invoice.issuedOn)}</td>
                  <td className="border border-slate-200 px-1.5 py-2 break-words">{invoice.vendor}</td>
                  <td className="border border-slate-200 px-1.5 py-2 break-words">{invoice.description}</td>
                  <td className="border border-slate-200 px-1.5 py-2 text-center">{invoice.quantity}</td>
                  <td className="border border-slate-200 px-1.5 py-2 text-right">{moneyCell(invoice, "TRY")}</td>
                  <td className="border border-slate-200 px-1.5 py-2 text-right">{moneyCell(invoice, "USD")}</td>
                  <td className="border border-slate-200 px-1.5 py-2 text-right">{moneyCell(invoice, "EUR")}</td>
                  <td className="border border-slate-200 px-1.5 py-2 break-words">{invoice.paymentLabel}</td>
                  <td className="border border-slate-200 px-1.5 py-2 break-words">{invoice.card}</td>
                  <td className="border border-slate-200 px-1.5 py-2 break-words">{invoice.person}</td>
                  <td className="border border-slate-200 px-1.5 py-2">
                    {invoice.document ? (
                      <a className="block break-all text-[#03624c]" href={`/api/fatura-belge/${invoice.document.id}`}>
                        {invoice.document.fileName}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
