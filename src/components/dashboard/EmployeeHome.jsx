"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, Megaphone, Utensils } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { sendToReviewAction, setWorkFocusAction } from "@/app/(panel)/is-takibi/actions";

const PRIORITY = {
  URGENT: "P0 — Acil",
  HIGH: "P1 — Öncelikli",
  NORMAL: "P2 — Normal",
  LOW: "P3 — Düşük",
};

function todayLabel() {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "long",
  }).format(new Date());
}

function dueLabel(iso) {
  if (!iso) return "Tarih yok";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function waitLabel(hours) {
  if (hours < 1) return "1 saatten az";
  if (hours < 24) return `${hours} saat`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} gün ${rest} saat` : `${days} gün`;
}

function ProductMark({ name }) {
  const letter = (name || "?").trim().charAt(0).toLocaleUpperCase("tr");
  return (
    <span title={name} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#03624c]/10 text-xs font-bold text-[#03624c]">
      {letter}
    </span>
  );
}

function NotificationBell({ count }) {
  const label = count > 0 ? `Bildirimler, ${count} okunmamış` : "Bildirimler";
  return (
    <Link href="/bildirimler" aria-label={label} className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50">
      <Bell size={18} />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#ff5a5f] px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export default function EmployeeHome({ home, alertCount }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState(home.choices[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState(null);
  const attentionEmpty = home.attention.revision.length + home.attention.overdue.length + home.attention.soon.length === 0;
  const showPicker = !home.focus || changing;

  async function choose(taskId) {
    if (!taskId || taskId === home.focus?.id) {
      setChanging(false);
      return;
    }
    setPending(true);
    const result = await setWorkFocusAction(taskId);
    setPending(false);
    setNote(result.ok ? null : result);
    if (result.ok) {
      setChanging(false);
      router.refresh();
    }
  }

  async function sendReview() {
    if (!home.focus) return;
    setPending(true);
    const result = await sendToReviewAction(home.focus.id);
    setPending(false);
    setNote(result);
    if (result.ok) router.refresh();
  }

  return (
    <div>
      <PageHeader
        title="Ana Sayfa"
        actions={
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-400">{todayLabel()}</p>
            <NotificationBell count={alertCount} />
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <section className="panel-card">
            <h2 className="text-base font-semibold">Şu an</h2>
            {showPicker ? (
              <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void choose(choice); }}>
                <p className="text-sm text-slate-600">Bugün ne üzerinde çalışacaksın?</p>
                {home.choices.length === 0 ? (
                  <p className="text-sm text-slate-500">Sana atanmış açık kart yok.</p>
                ) : (
                  <>
                    <select value={choice} onChange={(event) => setChoice(event.target.value)} className="field" aria-label="Üzerinde çalışılacak kart">
                      {home.choices.map((task) => (
                        <option key={task.id} value={task.id}>{task.title} · {task.product}</option>
                      ))}
                    </select>
                    <button type="submit" className="btn-primary" disabled={pending}>Seç</button>
                  </>
                )}
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{home.focus.title}</p>
                  <p className="truncate text-sm text-slate-500">{home.focus.product}{home.focus.columnLabel ? ` · ${home.focus.columnLabel}` : ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" disabled={pending} onClick={() => { setChoice(home.focus.id); setChanging(true); }}>Değiştir</button>
                  {home.focus.column !== "REVIEW" && home.focus.column !== "DONE" ? (
                    <button type="button" className="btn-primary" disabled={pending} onClick={() => void sendReview()}>Kontrole gönder</button>
                  ) : null}
                </div>
              </div>
            )}
            {note && !note.ok ? <p className="mt-2 text-sm text-red-700">{note.message}</p> : null}
          </section>

          <section className="panel-card">
            <h2 className="mb-2 text-base font-semibold">Dikkat gerektirenler</h2>
            {attentionEmpty ? (
              <p className="text-sm text-slate-600">Acil bir işin yok 🎉</p>
            ) : (
              <ul>
                {home.attention.revision.map((task) => (
                  <li key={`rev-${task.id}`} className="border-b border-red-100 bg-red-50 last:border-b-0">
                    <Link href={`/is-takibi?filtre=revize&kart=${task.id}`} className="flex items-center gap-3 px-1 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{task.title}</span>
                        <span className="block truncate text-sm text-red-700">Revize Ediliyor</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-red-700">{task.openItems} madde açık</span>
                    </Link>
                  </li>
                ))}
                {home.attention.overdue.map((task) => (
                  <li key={`late-${task.id}`} className="border-b border-red-100 bg-red-50 last:border-b-0">
                    <Link href={`/is-takibi?filtre=geciken&kart=${task.id}`} className="flex items-center gap-3 px-1 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{task.title}</span>
                        <span className="block truncate text-sm text-red-700">{task.columnLabel}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-red-700">{task.daysLate} gün geçti</span>
                    </Link>
                  </li>
                ))}
                {home.attention.soon.map((task) => (
                  <li key={`soon-${task.id}`} className="border-b border-slate-100 last:border-b-0">
                    <Link href={`/is-takibi?kart=${task.id}`} className="flex items-center gap-3 px-1 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{task.title}</span>
                        <span className="block truncate text-sm text-slate-500">{task.product}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-slate-600">{task.dueOn === home.today ? "Bugün" : "Yarın"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-card">
            <h2 className="text-base font-semibold">İşlerim</h2>
            {home.doingCount > 3 ? (
              <p className="mt-1 text-sm text-slate-500">Yapılıyor sütununda {home.doingCount} kartın var.</p>
            ) : null}
            {home.jobs.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Açık işin yok.</p>
            ) : (
              <ul className="mt-2">
                {home.jobs.map((task) => (
                  <li key={task.id} className="border-b border-slate-100 last:border-b-0">
                    <Link href={`/is-takibi?kart=${task.id}`} className="flex items-center gap-3 py-3">
                      <ProductMark name={task.product} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{task.title}</span>
                        <span className="block truncate text-sm text-slate-500">{PRIORITY[task.priority] ?? task.priority} · {task.columnLabel}</span>
                      </span>
                      <span className="shrink-0 text-sm text-slate-600">{dueLabel(task.dueOn)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-card">
            <h2 className="mb-2 text-base font-semibold">Kontrolde bekleyenlerim</h2>
            {home.review.length === 0 ? (
              <p className="text-sm text-slate-500">Kontrolde bekleyen kartın yok.</p>
            ) : (
              <ul>
                {home.review.map((task) => (
                  <li key={task.id} className="border-b border-slate-100 last:border-b-0">
                    <Link href={`/is-takibi?filtre=kontrol&kart=${task.id}`} className="flex items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{task.title}</span>
                        <span className="block truncate text-sm text-slate-500">{task.product}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-slate-600">{waitLabel(task.reviewHours)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="panel-card">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Utensils size={16} /> Yemek</h2>
            {home.meal.ordered ? (
              <p className="text-sm text-slate-700">{home.meal.label}</p>
            ) : (
              <>
                <p className="text-sm text-slate-700">Bugünkü yemek siparişini vermedin</p>
                <Link href="/yemek-yonetimi" className="mt-2 inline-block text-sm font-semibold text-[#03624c]">Sipariş sayfası</Link>
              </>
            )}
          </section>
          <section className="panel-card">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarDays size={16} /> İzin</h2>
            <p className="text-sm text-slate-700">
              {home.leave.remaining === null ? "Yıllık izin hakkın henüz açılmadı." : `Kalan yıllık izin: ${home.leave.remaining} gün`}
            </p>
            {home.leave.pending ? (
              <p className="mt-2 text-sm text-slate-500">Bekleyen talep: {home.leave.pending.label} · {dueLabel(home.leave.pending.startDate)}</p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Bekleyen izin talebin yok.</p>
            )}
            <Link href="/izin" className="mt-2 inline-block text-sm font-semibold text-[#03624c]">İzin sayfası</Link>
          </section>
          <section className="panel-card">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Megaphone size={16} /> Duyurular</h2>
            {home.announcements.length === 0 ? (
              <p className="text-sm text-slate-500">Duyuru yok.</p>
            ) : (
              <ul className="space-y-3">
                {home.announcements.map((item) => (
                  <li key={item.id}>
                    <p className="text-sm text-slate-800">{item.body}</p>
                    <p className="text-xs text-slate-400">{item.createdAt}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel-card">
            <h2 className="mb-2 text-sm font-semibold">Bu haftam</h2>
            <p className="text-sm text-slate-700">{home.week.done} kart tamamladın</p>
            <p className="mt-1 text-sm text-slate-500">
              {home.week.onTimePercent === null ? "Zamanında teslim oranı için bu hafta kapanan kart yok." : `Zamanında teslim: %${home.week.onTimePercent}`}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
