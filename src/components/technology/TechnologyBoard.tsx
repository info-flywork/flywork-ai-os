"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/Notice";
import { type KindCode } from "@/server/technology/labels";
import { deletePaidSubscriptionAction, deleteTechnologyAction, saveTechnologyAction, type TechnologyActionState } from "@/app/(panel)/teknoloji/actions";
import { type TechnologyDraft } from "@/server/technology/drafts";

type PaidSubscriptionRow = {
  id: string;
  name: string;
  cycle: string;
  cycleCode: "MONTHLY" | "YEARLY" | "USAGE";
  amount: string | null;
  currency: string | null;
  startedOn: string | null;
  lastPaidOn: string | null;
};

const KIND_LINE: Record<KindCode, string> = {
  SOFTWARE: "Yazılım / SaaS",
  API: "API servisi",
  DOMAIN: "Alan Adı",
  HOSTING: "Hosting / Sunucu",
  SSL: "SSL sertifikası",
  OTHER: "Diğer",
};

type ServiceRow = {
  id: string;
  name: string;
  vendor: string;
  kind: KindCode;
  ownerId: string | null;
  ownerName: string | null;
  websiteUrl: string | null;
  amount: string;
  currency: string;
  renewsOn: string;
  daysUntil: number;
  autoRenew: boolean;
  domainName: string | null;
  note: string | null;
};

type PageData = {
  people: { id: string; name: string }[];
  subscriptions: ServiceRow[];
};

function dayLabel(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function paymentPrice(row: PaidSubscriptionRow) {
  if (!row.amount || !row.currency) return "Değişken";
  return amountText(row.amount, row.currency === "TRY" ? "TL" : row.currency);
}

function hostOf(service: ServiceRow) {
  if (service.domainName) return service.domainName;
  if (!service.websiteUrl) return "";
  return service.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function vendorLine(vendor: string) {
  const trimmed = vendor.trim();
  if (!trimmed || trimmed.toLocaleLowerCase("tr") === "belirtilmedi") return "Sağlayıcı belirtilmedi";
  return trimmed;
}

function amountText(amount: string, currency: string) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return "—";
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted} ${currency}`;
}

function ServiceForm({
  editing,
  editingPayment,
  draft,
}: {
  editing: ServiceRow | null;
  editingPayment: PaidSubscriptionRow | null;
  draft: TechnologyDraft | null;
}) {
  const [state, action, pending] = useActionState<TechnologyActionState, FormData>(saveTechnologyAction, null);
  const locked = Boolean(editing || editingPayment);
  const [recordKind, setRecordKind] = useState(editingPayment ? "payment" : "service");
  const host = editing ? hostOf(editing) : "";
  const payment = recordKind === "payment";
  const title = editingPayment ? "Aboneliği düzenle" : editing ? "Hizmeti düzenle" : "Kayıt ekle";
  return (
    <form action={action} className="panel-card grid grid-cols-1 gap-3 sm:grid-cols-2">
      <h2 className="section-title sm:col-span-2">{title}</h2>
      {state ? <div className="sm:col-span-2"><Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice></div> : null}
      {editing || editingPayment ? <input type="hidden" name="id" value={editing?.id ?? editingPayment?.id} /> : null}
      {locked ? <input type="hidden" name="recordKind" value={recordKind} /> : null}
      <label className="text-sm sm:col-span-2">Kayıt türü
        <select
          name={locked ? undefined : "recordKind"}
          value={recordKind}
          disabled={locked}
          onChange={(event) => setRecordKind(event.target.value)}
          className="field mt-1"
        >
          <option value="payment">Ödeme aboneliği</option>
          <option value="service">Alan adı veya sunucu</option>
        </select>
      </label>
      {payment ? (
        <>
          <label className="text-sm">Abonelik adı
            <input name="name" required defaultValue={editingPayment?.name ?? ""} className="field mt-1" />
          </label>
          <label className="text-sm">Dönem
            <select name="cycle" defaultValue={editingPayment?.cycleCode ?? "MONTHLY"} className="field mt-1">
              <option value="MONTHLY">Aylık</option>
              <option value="YEARLY">Yıllık</option>
              <option value="USAGE">Kullanıma bağlı</option>
            </select>
          </label>
          <label className="text-sm">İlk ödeme
            <input type="date" name="startedOn" defaultValue={editingPayment?.startedOn ?? ""} className="field mt-1" />
          </label>
          <label className="text-sm">Son ödeme
            <input type="date" name="lastPaidOn" defaultValue={editingPayment?.lastPaidOn ?? ""} className="field mt-1" />
          </label>
          <label className="text-sm">Tutar
            <input name="amount" inputMode="decimal" defaultValue={editingPayment?.amount && Number(editingPayment.amount) !== 0 ? editingPayment.amount : ""} placeholder="Boşsa değişken" className="field mt-1" />
          </label>
          <label className="text-sm">Para birimi
            <select name="currency" defaultValue={editingPayment?.currency ?? "USD"} className="field mt-1">
              <option value="USD">USD</option>
              <option value="TRY">TRY</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
        </>
      ) : (
        <>
          <label className="text-sm">Hizmet adı
            <input name="name" required defaultValue={editing?.name ?? draft?.name ?? ""} className="field mt-1" />
          </label>
          <label className="text-sm">Kategori
            <select name="kind" required defaultValue={editing?.kind ?? "SOFTWARE"} className="field mt-1">
              {Object.entries(KIND_LINE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm">Sağlayıcı
            <input name="vendor" defaultValue={editing && vendorLine(editing.vendor) !== "Sağlayıcı belirtilmedi" ? editing.vendor : ""} placeholder="Boş bırakılırsa belirtilmedi" className="field mt-1" />
          </label>
          <label className="text-sm">Site veya alan adı
            <input name="host" defaultValue={host} placeholder="fly-work.com" className="field mt-1" />
          </label>
          <label className="text-sm">Bitiş
            <input type="date" name="renewsOn" required defaultValue={editing?.renewsOn ?? draft?.renewsOn ?? ""} className="field mt-1" />
          </label>
          <label className="text-sm">Yenileme
            <select name="autoRenew" defaultValue={editing?.autoRenew ? "yes" : "no"} className="field mt-1">
              <option value="no">Bilinmiyor</option>
              <option value="yes">Otomatik</option>
            </select>
          </label>
          <label className="text-sm">Tutar
            <input name="amount" inputMode="decimal" defaultValue={editing && Number(editing.amount) !== 0 ? editing.amount : ""} placeholder="Boş bırakılabilir" className="field mt-1" />
          </label>
          <label className="text-sm">Para birimi
            <select name="currency" defaultValue={editing?.currency ?? "TRY"} className="field mt-1">
              <option value="TRY">TRY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label className="text-sm sm:col-span-2">Not
            <input name="note" defaultValue={editing?.note ?? ""} className="field mt-1" />
          </label>
        </>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button disabled={pending} className="btn-primary">{pending ? "Kaydediliyor…" : "Kaydet"}</button>
        {locked ? <a className="btn-secondary" href="/teknoloji">Vazgeç</a> : null}
      </div>
    </form>
  );
}

function DeleteButton({
  id,
  field,
  remove,
  confirm,
}: {
  id: string;
  field: string;
  remove: (state: TechnologyActionState, formData: FormData) => Promise<TechnologyActionState>;
  confirm: string;
}) {
  const [state, action, pending] = useActionState<TechnologyActionState, FormData>(remove, null);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      <input type="hidden" name={field} value={id} />
      <button disabled={pending} className="inline-flex min-h-10 items-center rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600">
        {pending ? "Siliniyor…" : "Sil"}
      </button>
      {state && !state.ok ? <Notice tone="err">{state.message}</Notice> : null}
    </form>
  );
}

export default function TechnologyBoard({
  data,
  payments,
  editing,
  editingPayment,
  draft,
}: {
  data: PageData;
  payments: PaidSubscriptionRow[];
  editing: ServiceRow | null;
  editingPayment: PaidSubscriptionRow | null;
  draft: TechnologyDraft | null;
}) {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="page-title">Abonelikler</h1>
        <p className="page-lead">Ödeme abonelikleri, alan adları ve sunucular.</p>
      </header>

      <section className="panel-card">
        <h2 className="section-title">Ödeme abonelikleri</h2>
        <p className="mt-1 text-sm text-slate-500">Tarihler dosyadaki ilk ve son ödemedir. Yenileme tarihi değildir.</p>
        {payments.length === 0 ? <p className="mt-3 text-sm text-slate-500">Ödeme aboneliği yok.</p> : (
          <ul className="mt-3 divide-y divide-slate-100">
            {payments.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{row.name}</p>
                  <p className="text-sm text-slate-500">{row.cycle} · Devam ediyor</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a className="btn-secondary" href={`/teknoloji?odeme=${row.id}`}>Düzenle</a>
                    <DeleteButton id={row.id} field="id" remove={deletePaidSubscriptionAction} confirm="Bu abonelik silinsin mi?" />
                  </div>
                </div>
                <div className="text-sm text-slate-600 sm:text-right">
                  <p className="font-semibold text-slate-900">{paymentPrice(row)}</p>
                  <p>İlk ödeme: {dayLabel(row.startedOn)}</p>
                  <p>Son ödeme: {dayLabel(row.lastPaidOn)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="section-title">Alan adları ve sunucular</h2>
      {data.subscriptions.length === 0 ? <p className="panel-card text-sm text-slate-500">Kayıtlı hizmet yok.</p> : (
        <div className="space-y-4">
          {data.subscriptions.map((service) => {
            const soon = service.daysUntil <= 30;
            const host = hostOf(service);
            return (
              <article key={service.id} className="panel-card">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-xs text-slate-400">{KIND_LINE[service.kind]} · {vendorLine(service.vendor)}</p>
                  <p className={`shrink-0 text-sm font-semibold ${soon ? "text-orange-600" : "text-[#03624c]"}`}>
                    {soon ? `${service.daysUntil} gün kaldı` : `Aktif · ${service.daysUntil} gün`}
                  </p>
                </div>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{service.name}</h2>
                {host ? <p className="text-sm text-slate-500">{host}</p> : null}
                <p className="mt-3 text-sm text-slate-700">
                  <span className="font-semibold">Bitiş:</span> {service.renewsOn}{" "}
                  <span className="ml-2 font-semibold">Yenileme:</span> {service.autoRenew ? "Otomatik" : "Bilinmiyor"}{" "}
                  <span className="ml-2 font-semibold">Tutar:</span> {amountText(service.amount, service.currency)}
                </p>
                {service.note ? <p className="mt-2 text-sm text-slate-600">{service.note}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <a className="btn-secondary" href={`/teknoloji?kayit=${service.id}`}>Düzenle</a>
                  <DeleteButton id={service.id} field="subscriptionId" remove={deleteTechnologyAction} confirm="Bu hizmet silinsin mi?" />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ServiceForm
        key={editingPayment?.id ?? editing?.id ?? "yeni"}
        editing={editing}
        editingPayment={editingPayment}
        draft={draft}
      />
    </div>
  );
}
