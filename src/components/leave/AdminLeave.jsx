"use client";

import Link from "next/link";
import { useActionState, useFormStatus } from "react";
import Notice from "@/components/Notice";
import { LeaveRequestDesk } from "@/components/leave/EmployeeLeave";
import {
  reverseLeaveAction,
  reviewLeaveAction,
  settleLeaveAction,

} from "@/app/(panel)/izin/actions";

const TYPE_LABELS = {
  ANNUAL: "Yıllık izin",
  SICK: "Raporlu izin",
  EXCUSE: "Mazeret izni",
  UNPAID: "Ücretsiz izin",
};

const AUDIT_LABELS = {
  REQUESTED: "Talep oluşturuldu",
  CANCELLED: "İptal edildi",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  REVERSED: "Onay geri alındı",
  BALANCE_SET: "Bakiye tanımlandı",
  BALANCE_DEDUCTED: "Bakiyeden düşüldü",
  BALANCE_RESTORED: "Bakiye iade edildi",
  SALARY_SETTLED: "Maaştan kesildi",
  ANNUAL_SETTLED: "Yıllık izinden düşüldü",
};

const STATUS_LABELS = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
};

const TABS = [
  ["ozet", "Özet"],
  ["bekleyen", "Onay bekleyenler"],
  ["onaylanan", "Onaylananlar"],
  ["talep", "Yeni talep"],
] ;

 


































function startLabel(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}









function formatQuantity(value) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const shown = trimmed ? `${grouped},${trimmed}` : grouped;
  return negative ? `-${shown}` : shown;
}

function remainingText(value) {
  return value === null ? "Henüz hak etmedi" : `${formatQuantity(value)} gün`;
}

function tabHref(tab) {
  return `/izin?sekme=${tab}`;
}

function BusyButton({ children, pendingLabel, className }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

function StateForm({
  action,
  className,
  children,
  id,
  confirm,
}





) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      id={id}
      action={formAction}
      className={className ?? "space-y-3"}
      onSubmit={confirm ? (event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      } : undefined}
    >
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <fieldset disabled={pending} className={confirm ? "inline-flex border-0 p-0" : "space-y-3"}>
        {children}
      </fieldset>
    </form>
  );
}

function SettleButtons({
  requestId,
  dayCount,
  settlement,
}



) {
  const days = `${formatQuantity(dayCount)} gün`;
  return (
    <>
      {settlement === "SALARY" ? (
        <span className="btn-primary cursor-default">Maaştan kesildi</span>
      ) : (
        <StateForm
          action={settleLeaveAction}
          className="inline-flex"
          confirm={`${days} maaştan kesildi olarak işaretlenecek ve kullanılan izinden düşecek.`}
        >
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="settlement" value="SALARY" />
          <button className="btn-secondary" type="submit">Maaştan kesildi</button>
        </StateForm>
      )}
      {settlement === "ANNUAL" ? (
        <span className="btn-primary cursor-default">Yıllık izinden düşüldü</span>
      ) : (
        <StateForm
          action={settleLeaveAction}
          className="inline-flex"
          confirm={`${days} yıllık izinden düşüldü olarak işaretlenecek ve kullanılan izinde kalacak.`}
        >
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="settlement" value="ANNUAL" />
          <button className="btn-secondary" type="submit">Yıllık izinden düşüldü</button>
        </StateForm>
      )}
    </>
  );
}

function RequestCard({ request, canReview }) {
  return (
    <article className="border-b border-slate-100 py-4 last:border-b-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <strong>{request.employeeName}</strong>
        <span className="text-sm text-slate-500">{STATUS_LABELS[request.status] ?? request.status}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {TYPE_LABELS[request.type] ?? request.type} · {request.startDate}
        {request.endDate !== request.startDate ? ` – ${request.endDate}` : ""}
        {request.startTime ? ` · ${request.startTime}–${request.endTime}` : ""} · {formatQuantity(request.dayCount)} gün
        {request.hourCount ? ` (${formatQuantity(request.hourCount)} saat)` : ""}
      </p>
      {request.reason ? <p className="mt-1 text-sm">{request.reason}</p> : null}
      {request.reviewerName ? (
        <p className="mt-1 text-sm text-slate-500">
          {request.reviewerName} · {request.reviewedAt}
          {request.reviewNote ? `: ${request.reviewNote}` : ""}
          {request.balanceException ? " · bakiye istisnası" : ""}
        </p>
      ) : null}
      {request.document ? (
        <a className="mt-1 inline-block text-sm text-[#03624c] underline" href={`/api/izin-belge/${request.document.id}`}>
          {request.document.fileName}
        </a>
      ) : null}
      {request.audits.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          {request.audits.map((audit) => (
            <li key={audit.id}>
              {audit.at} · {audit.actorName} · {AUDIT_LABELS[audit.action] ?? audit.action}
              {audit.note ? ` · ${audit.note}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {canReview && request.status === "PENDING" ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <StateForm action={reviewLeaveAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="decision" value="APPROVED" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="balanceException" />
              Bakiye yetersiz olsa da onayla
            </label>
            <BusyButton className="btn-primary" pendingLabel="Onaylanıyor…">Onayla</BusyButton>
          </StateForm>
          <StateForm action={reviewLeaveAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="decision" value="REJECTED" />
            <input name="reviewNote" required minLength={2} placeholder="Ret gerekçesi" className="field" />
            <BusyButton className="btn-secondary" pendingLabel="Kaydediliyor…">Reddet</BusyButton>
          </StateForm>
        </div>
      ) : null}
      {canReview && request.status === "APPROVED" ? (
        <div className="mt-3 space-y-2">
          <StateForm action={reverseLeaveAction} className="space-y-2" id={`geri-${request.id}`}>
            <input type="hidden" name="requestId" value={request.id} />
            <input name="note" placeholder="Geri alma notu" className="field" />
          </StateForm>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" type="submit" form={`geri-${request.id}`}>Onayı geri al</button>
            {request.type === "UNPAID" ? (
              <SettleButtons requestId={request.id} dayCount={request.dayCount} settlement={request.settlement} />
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function AdminLeave({
  view,
  requestForm,
  canReview = true,
}



) {
  const person = view.roster.find((row) => row.id === view.selectedEmployeeId) ?? null;
  const personRequests = person ? view.requests.filter((request) => request.employeeId === person.id) : [];
  const pending = view.requests.filter((request) => request.status === "PENDING");
  const approved = view.requests.filter((request) => request.status === "APPROVED");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Flywork / Çalışma alanı</p>
          <h1 className="page-title mt-1">İzin Talebi</h1>
        </div>
        <p className="w-fit rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">{view.todayLabel}</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <Link key={id} className={id === view.tab ? "btn-primary" : "btn-secondary"} href={tabHref(id)}>
            {label}
          </Link>
        ))}
      </div>

      <section className="space-y-4">
        {view.tab === "talep" ? (
          canReview ? <LeaveRequestDesk {...requestForm} /> : <p className="text-sm text-slate-500">Bu hesap izin talebi açmaz. Onaylar yetkili yöneticiye gider.</p>
        ) : <h2 className="section-title">İzin yönetimi</h2>}

        {view.tab === "ozet" && !person ? (
          <>
            {view.roster.length === 0 ? (
              <p className="text-sm text-slate-500">Gösterilecek çalışan yok.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {view.roster.map((row) => (
                  <Link key={row.id} className="panel-card flex min-h-44 flex-col justify-between no-underline hover:border-[#03624c]" href={`/izin?sekme=ozet&calisan=${row.id}`}>
                    <span>
                      <span className="block text-lg font-semibold text-slate-900">{row.name}</span>
                      {row.startedOn ? (
                        <span className="mt-1 block text-sm font-normal text-slate-500">İşe başlama: {startLabel(row.startedOn)}</span>
                      ) : null}
                    </span>
                    <span className="mt-6 grid grid-cols-3 gap-3">
                      <span>
                        <span className="block text-xs text-slate-500">Toplam kullanılan izin</span>
                        <span className="mt-1 block text-2xl font-semibold text-slate-900">{formatQuantity(row.usedDays)} gün</span>
                      </span>
                      <span>
                        <span className="block text-xs text-slate-500">Mazeret izni</span>
                        <span className="mt-1 block text-2xl font-semibold text-slate-900">{formatQuantity(row.excuseDays)} gün</span>
                      </span>
                      <span>
                        <span className="block text-xs text-slate-500">Yıllık izinden kalan</span>
                        <span className={`mt-1 block font-semibold text-slate-900 ${row.remainingDays === null ? "text-base" : "text-2xl"}`}>{remainingText(row.remainingDays)}</span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : null}

        {view.tab === "ozet" && person ? (
          <div className="panel-card">
            <Link className="text-sm font-semibold text-[#03624c] no-underline" href={tabHref("ozet")}>Listeye dön</Link>
            <div className="mt-3">
              <h3 className="text-lg font-semibold">{person.name}</h3>
              {person.startedOn ? <p className="mt-1 text-sm text-slate-500">İşe başlama: {startLabel(person.startedOn)}</p> : null}
              <p className="mt-1 text-sm text-slate-500">Toplam kullanılan izin: {formatQuantity(person.usedDays)} gün</p>
              <p className="text-sm text-slate-500">Mazeret izni: {formatQuantity(person.excuseDays)} gün</p>
              <p className="text-sm text-slate-500">Yıllık izinden kalan: {remainingText(person.remainingDays)}</p>
            </div>
            {personRequests.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">İzin kaydı yok.</p>
            ) : (
              <div className="mt-2">
                {personRequests.map((request) => <RequestCard key={request.id} request={request} canReview={canReview} />)}
              </div>
            )}
          </div>
        ) : null}

        {view.tab === "bekleyen" ? (
          <div className="panel-card">
            {pending.length === 0 ? <p className="text-sm text-slate-500">Onay bekleyen talep yok.</p> : pending.map((request) => <RequestCard key={request.id} request={request} canReview={canReview} />)}
          </div>
        ) : null}

        {view.tab === "onaylanan" ? (
          <div className="panel-card">
            {approved.length === 0 ? <p className="text-sm text-slate-500">Onaylanan talep yok.</p> : approved.map((request) => <RequestCard key={request.id} request={request} canReview={canReview} />)}
          </div>
        ) : null}
      </section>

    </div>
  );
}
