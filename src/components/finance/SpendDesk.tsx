"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Notice from "@/components/Notice";
import { createExpenseAction, setSettlementAction, type FinanceActionState } from "@/app/(panel)/harcama/actions";
import {
  CATEGORIES_BY_SCOPE,
  CATEGORY_LABELS,
  type CategoryCode,
} from "@/server/finance/catalog";
import { OFFICE_SPENDERS, withAllCurrencies } from "@/server/finance/cards";

type CardTotal = {
  label: string;
  byCurrency: { currency: string; total: string; count: number }[];
};

type ExpenseItem = {
  id: string;
  title: string;
  spentOn: string;
  amount: string;
  currency: string;
  userName: string;
  category: CategoryCode;
  accountLabel: string | null;
  createdAt: string;
  recordedAt: string;
  note: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID";
  reimbursement: "NOT_REQUIRED" | "PENDING" | "PAID";
  document: { id: string; fileName: string } | null;
};

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

const PAYMENTS = [
  ["CARD", "Kredi kartı"],
  ["TRANSFER", "Banka havalesi"],
  ["CASH", "Nakit"],
  ["OTHER", "Diğer"],
] as const;

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-");
  return `${MONTHS[Number(monthNumber) - 1] ?? month} ${year}`;
}

function formatDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

function formatMoney(amount: string, currency: string) {
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return `${formatted} ${currency === "TRY" ? "TL" : currency}`;
}

function CurrencyCard({
  label,
  rows,
}: {
  label: string;
  rows: { currency: string; total: string; count: number }[];
}) {
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

function SettlementButton({ unpaid }: { unpaid: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className={
        unpaid
          ? "inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
          : "inline-flex min-h-10 items-center rounded-full bg-[#03624c] px-4 text-sm font-semibold text-white disabled:opacity-60"
      }
    >
      {pending ? "Kaydediliyor…" : unpaid ? "Ödenmedi" : "Ödendi"}
    </button>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn-primary w-full">
      {pending ? "Kaydediliyor…" : "Harcamayı kaydet"}
    </button>
  );
}

export default function SpendDesk({
  today,
  actorId,
  month,
  spenders,
  cards,
  totals,
  expenses,
}: {
  today: string;
  actorId: string;
  month: string;
  spenders: { id: string; name: string }[];
  cards: CardTotal[];
  totals: { currency: string; total: string; count: number }[];
  expenses: ExpenseItem[];
}) {
  const [state, action] = useActionState<FinanceActionState, FormData>(createExpenseAction, null);
  const [settlementState, settlementAction] = useActionState<FinanceActionState, FormData>(setSettlementAction, null);
  const [showSettlement, setShowSettlement] = useState(false);
  useEffect(() => {
    if (!settlementState) return;
    setShowSettlement(true);
    const timer = window.setTimeout(() => setShowSettlement(false), 2000);
    return () => window.clearTimeout(timer);
  }, [settlementState]);
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number][0]>("CARD");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const categories = CATEGORIES_BY_SCOPE.OFFICE;
  const visibleSpenders = OFFICE_SPENDERS.flatMap((name) => {
    const person = spenders.find((item) => item.name === name);
    return person ? [person] : [];
  });
  const monthExpenses = expenses
    .filter((expense) => expense.spentOn.startsWith(month))
    .sort((left, right) => left.spentOn.localeCompare(right.spentOn) || left.recordedAt.localeCompare(right.recordedAt));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Ofis Harcamaları</h1>
      </header>

      <section>
        <h2 className="section-title">Bu ay kart bazında</h2>
        <p className="mb-3 text-sm text-slate-500">
          {monthLabel(month)} · Ofis harcamaları
        </p>
        <div className="grid grid-cols-3 gap-3">
          {cards.map((card) => (
            <CurrencyCard key={card.label} label={card.label} rows={card.byCurrency} />
          ))}
          <CurrencyCard label="Toplam harcama" rows={totals} />
        </div>
      </section>

      <form action={action} className="panel-card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="section-title mb-1">Harcama ekle</h2>
          <p className="text-sm text-slate-500">Bu kayıt ofis listesine elle eklenir.</p>
        </div>
        {state ? (
          <div className="sm:col-span-2">
            <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice>
          </div>
        ) : null}
        <input type="hidden" name="scope" value="OFFICE" />
        <label className="text-sm sm:col-span-2">
          Ne alındı / nereden?
          <input name="title" required minLength={2} placeholder="Örn. Su, Market" className="field mt-1" />
        </label>
        <label className="text-sm">
          Tutar
          <input name="amount" required inputMode="decimal" placeholder="214,90" className="field mt-1" />
        </label>
        <label className="text-sm">
          Para birimi
          <select name="currency" defaultValue="TRY" className="field mt-1">
            <option value="TRY">TL</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label className="text-sm">
          Tarih
          <input type="date" name="spentOn" required defaultValue={today} className="field mt-1" />
        </label>
        <label className="text-sm">
          Kategori
          <select name="category" required defaultValue="" className="field mt-1">
            <option value="" disabled>
              Seç
            </option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Ödeme türü
          <select
            name="paymentMethod"
            value={payment}
            onChange={(event) => setPayment(event.target.value as (typeof PAYMENTS)[number][0])}
            className="field mt-1"
          >
            {PAYMENTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {payment === "CARD" ? (
          <label className="text-sm">
            Kart
            <select name="accountLabel" required defaultValue={cards[0]?.label ?? ""} className="field mt-1">
              {cards.map((card) => (
                <option key={card.label} value={card.label}>
                  {card.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="self-end text-sm text-slate-500">Nakit ve havale kart toplamına yazılmaz.</p>
        )}
        <label className="text-sm sm:col-span-2">
          Harcamayı yapan
          <select name="userId" defaultValue={visibleSpenders.some((person) => person.id === actorId) ? actorId : visibleSpenders[0]?.id} className="field mt-1">
            {visibleSpenders.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          Açıklama
          <input name="note" placeholder="İsteğe bağlı" className="field mt-1" />
        </label>
        <div className="sm:col-span-2">
          <p className="text-sm font-medium text-slate-700" id="expense-file-label">Fatura ekle</p>
          <p className="mt-1 text-sm text-slate-500">İsteğe bağlı. Fatura veya fiş yükleyebilirsin.</p>
          <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="expense-file" className="btn-secondary cursor-pointer">Dosya seç</label>
              <input
                ref={fileInput}
                id="expense-file"
                name="belge"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                aria-labelledby="expense-file-label"
                className="sr-only"
                onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? null)}
              />
              <p className="min-w-0 text-sm text-slate-600">
                {fileName ? <span className="font-medium text-slate-900">{fileName}</span> : "Henüz dosya seçilmedi"}
                <span className="mt-1 block text-xs text-slate-500">PDF, JPG, PNG veya WEBP. En fazla 8 MB.</span>
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
        </div>
        <div className="sm:col-span-2">
          <SaveButton />
        </div>
      </form>

      <section className="panel-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0">Bu ayki giderler</h2>
        </div>
        {showSettlement && settlementState ? <Notice tone={settlementState.ok ? "ok" : "err"}>{settlementState.message}</Notice> : null}
        {monthExpenses.length === 0 ? (
          <p className="text-sm text-slate-500">Bu ay kayıtlı gider yok.</p>
        ) : (
          <ul>
            {monthExpenses.map((expense) => {
              const unpaid = expense.reimbursement === "PENDING";
              return (
                <li key={expense.id} className="grid grid-cols-[minmax(0,1fr)_9rem_14rem] items-center gap-x-3 border-b border-slate-100 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{expense.title}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatDate(expense.spentOn)}
                      {" · "}
                      {expense.userName}
                      {expense.note === "Zorunlu" ? " · Zorunlu" : ""}
                      {expense.accountLabel ? ` · ${expense.accountLabel}` : ""}
                    </p>
                    {expense.document ? (
                      <a className="mt-1 block truncate text-sm text-[#03624c]" href={`/api/harcama-belge/${expense.document.id}`}>
                        {expense.document.fileName}
                      </a>
                    ) : null}
                  </div>
                  <p className="text-right text-sm font-semibold tabular-nums whitespace-nowrap text-slate-900">{formatMoney(expense.amount, expense.currency)}</p>
                  <div className="min-w-0">
                    {expense.status === "REJECTED" || expense.status === "SUBMITTED" ? null : (
                      <form action={settlementAction} className="flex justify-end">
                        <input type="hidden" name="expenseId" value={expense.id} />
                        <input type="hidden" name="paid" value={unpaid ? "yes" : "no"} />
                        <SettlementButton unpaid={unpaid} />
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
