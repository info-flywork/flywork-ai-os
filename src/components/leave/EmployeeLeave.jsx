"use client";

import { useActionState, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import Notice from "@/components/Notice";
import { cancelLeaveAction, createLeaveAction } from "@/app/(panel)/izin/actions";

const TYPE_LABELS = {
  ANNUAL: "Yıllık izin",
  SICK: "Raporlu izin",
  EXCUSE: "Mazeret izni",
  UNPAID: "Ücretsiz izin",
};

const TYPE_HELP = {
  ANNUAL: "Yıllık izin bakiyenizden düşülür.",
  UNPAID: "Ücretsiz izin yıllık bakiyenizden düşülür.",
  EXCUSE: "Mazeret izni yıllık bakiyeden düşülmez.",
  SICK: "Raporlu izin yıllık bakiyeden düşülmez.",
};

const STATUS_LABELS = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
};

const DURATION_LABELS = {
  FULL_DAY: "Tam gün",
  MULTI_DAY: "Birden fazla gün",
  HOURLY: "Saatlik",
};

const DURATIONS = [
  ["HOURLY", "Saatlik"],
  ["FULL_DAY", "Tam Gün"],
  ["MULTI_DAY", "Birden fazla gün"],
] ;




















const AUDIT_LABELS = {
  REQUESTED: "Talep oluşturuldu",
  CANCELLED: "İptal edildi",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  REVERSED: "Onay geri alındı",
  BALANCE_SET: "Bakiye tanımlandı",
  BALANCE_DEDUCTED: "Bakiyeden düşüldü",
  BALANCE_RESTORED: "Bakiye iade edildi",
};

 





function formatQuantity(value) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const shown = trimmed ? `${grouped},${trimmed}` : grouped;
  return negative ? `-${shown}` : shown;
}

export function LeaveRequestDesk({ today, balance, requests, showTotals = true }) {
  const [state, action, pending] = useActionState(createLeaveAction, undefined);
  const [duration, setDuration] = useState("HOURLY");
  const [type, setType] = useState("ANNUAL");
  const [fileName, setFileName] = useState(null);
  const fileInput = useRef(null);
  const pendingCount = requests.filter((request) => request.status === "PENDING").length;
  const visibleCount = requests.filter((request) => request.status !== "CANCELLED").length;
  const used = balance ? Number(balance.usedDays) : 0;
  const allocated = balance ? Number(balance.allocatedDays) : 0;
  const progress = allocated > 0 ? Math.min(100, Math.max(0, (used / allocated) * 100)) : 0;

  return (
    <div className="space-y-6">
      <h2 className="section-title">İzin Talebi</h2>

      <div className={showTotals ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]" : ""}>
        <form action={action} className="panel-card space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Yeni İzin Talebi</h3>
          {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
          <div>
            <label className="mb-1 block text-sm text-slate-600" htmlFor="leave-type">İzin türü</label>
            <select
              id="leave-type"
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="field"
            >
              <option value="ANNUAL">Yıllık İzin</option>
              <option value="UNPAID">Ücretsiz İzin</option>
              <option value="EXCUSE">Mazeret İzni</option>
              <option value="SICK">Raporlu İzin</option>
            </select>
            <p className="mt-2 text-sm text-slate-500">{TYPE_HELP[type]}</p>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm text-slate-600">Süre</legend>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${duration === id ? "bg-[#03624c] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                  aria-pressed={duration === id}
                  onClick={() => setDuration(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input type="hidden" name="duration" value={duration} />
          </fieldset>
          <div className={duration === "MULTI_DAY" ? "grid gap-3 sm:grid-cols-2" : ""}>
            <div>
              <label className="mb-1 block text-sm text-slate-600" htmlFor="leave-start">
                {duration === "MULTI_DAY" ? "Başlangıç tarihi" : "Tarih"}
              </label>
              <input id="leave-start" name="startDate" type="date" required defaultValue={today} className="field" />
            </div>
            {duration === "MULTI_DAY" ? (
              <div>
                <label className="mb-1 block text-sm text-slate-600" htmlFor="leave-end">Bitiş tarihi</label>
                <input id="leave-end" name="endDate" type="date" required defaultValue={today} className="field" />
              </div>
            ) : null}
          </div>
          {duration === "HOURLY" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-slate-600" htmlFor="leave-start-time">Başlangıç saati</label>
                <input id="leave-start-time" name="startTime" type="time" required defaultValue="09:00" className="field" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600" htmlFor="leave-end-time">Bitiş saati</label>
                <input id="leave-end-time" name="endTime" type="time" required defaultValue="13:00" className="field" />
              </div>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm text-slate-600" htmlFor="leave-reason">İzin nedeni *</label>
            <textarea
              id="leave-reason"
              name="reason"
              required
              minLength={2}
              rows={4}
              placeholder="Örn. diş randevusu, hastalık"
              className="field"
            />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700" id="leave-file-label">Belge ekle</p>
            <p className="mt-1 text-sm text-slate-500">İsteğe bağlı. Rapor, dilekçe veya fotoğraf yükleyebilirsin.</p>
            <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="leave-file" className="btn-secondary cursor-pointer">Dosya seç</label>
                <input
                  ref={fileInput}
                  id="leave-file"
                  name="document"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  aria-labelledby="leave-file-label"
                  className="sr-only"
                  onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? null)}
                />
                <p className="min-w-0 text-sm text-slate-600">
                  {fileName ? <span className="font-medium text-slate-900">{fileName}</span> : "Henüz dosya seçilmedi"}
                  <span className="mt-1 block text-xs text-slate-500">PDF, JPG veya PNG. En fazla 5 MB.</span>
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
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? "Gönderiliyor…" : "Talebi Gönder"}
          </button>
        </form>

        {showTotals ? (
          <div className="space-y-4">
            <section className="panel-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">İzin Durumun</h3>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{visibleCount} talep</p>
                  <p className="mt-1 text-sm text-slate-500">{pendingCount} talep onay bekliyor</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#03624c]/10 text-[#03624c]">
                  <LayoutGrid size={18} aria-hidden="true" />
                </span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#03624c]" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-3 text-sm text-slate-500">
                {balance
                  ? `Kalan ${formatQuantity(balance.remainingDays)} gün. Tanımlı ${formatQuantity(balance.allocatedDays)} gün.`
                  : "İzin hakkı bakiyesi mevcut verilerde bulunmuyor."}
              </p>
            </section>
          </div>
        ) : null}
      </div>

      <section className="panel-card">
        <h3 className="section-title">Geçmiş talepler</h3>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500">Kayıtlı talep yok.</p>
        ) : (
          <div>
            {requests.map((request) => (
              <article key={request.id} className="border-b border-slate-100 py-4 last:border-b-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <strong>{TYPE_LABELS[request.type] ?? request.type} · {DURATION_LABELS[request.duration] ?? request.duration}</strong>
                  <span className="text-sm text-slate-500">{STATUS_LABELS[request.status] ?? request.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {request.startDate}
                  {request.endDate !== request.startDate ? ` – ${request.endDate}` : ""}
                  {request.startTime ? ` · ${request.startTime}–${request.endTime}` : ""} · {formatQuantity(request.dayCount)} gün
                  {request.hourCount ? ` (${formatQuantity(request.hourCount)} saat)` : ""}
                </p>
                {request.reason ? <p className="mt-1 text-sm">{request.reason}</p> : null}
                {request.reviewNote ? (
                  <p className="mt-1 text-sm text-slate-500">
                    {request.reviewerName ?? "Yönetici"} · {request.reviewedAt}: {request.reviewNote}
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
                {request.status === "PENDING" ? <CancelForm requestId={request.id} /> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function EmployeeLeave({
  todayLabel,
  today,
  requests,
}) {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Flywork / Çalışma alanı</p>
          <h1 className="page-title mt-1">İzin Talebi</h1>
        </div>
        <p className="w-fit rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">{todayLabel}</p>
      </header>
      <LeaveRequestDesk today={today} balance={null} requests={requests} showTotals={false} />
    </div>
  );
}

function CancelForm({ requestId }) {
  const [state, action, pending] = useActionState(cancelLeaveAction, undefined);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="requestId" value={requestId} />
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <button type="submit" disabled={pending} className="btn-secondary">
        {pending ? "İptal ediliyor…" : "Talebi iptal et"}
      </button>
    </form>
  );
}
