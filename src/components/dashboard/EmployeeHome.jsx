"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { refreshQuiet } from "@/client/refreshQuiet";
import { Bell, CalendarClock, CalendarDays, ClipboardCheck, Megaphone, RotateCcw, TriangleAlert, Utensils } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import StatCard from "@/components/ui/StatCard";
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

function TaskRow({ href, title, meta, aside, tone = "plain" }) {
  const toneClass = tone === "red" ? "bg-red-50" : tone === "orange" ? "bg-orange-50" : tone === "today" ? "bg-amber-50" : "";
  return (
    <li className={`border-b border-slate-100 last:border-b-0 ${toneClass}`}>
      <Link href={href} className="flex items-center gap-3 px-1 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
          <span className="block truncate text-sm text-slate-500">{meta}</span>
        </span>
        <span className={`shrink-0 text-sm font-semibold ${tone === "red" ? "text-red-700" : tone === "orange" ? "text-orange-700" : "text-slate-600"}`}>{aside}</span>
      </Link>
    </li>
  );
}

export default function EmployeeHome({ home, alertCount }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState(home.choices[0]?.id ?? "");
  const [note, setNote] = useState(null);
  const [focus, setFocus] = useState(home.focus);
  useEffect(() => {
    setFocus(home.focus);
  }, [home.focus]);
  const overdue = home.jobs.filter((task) => task.daysLate > 0);
  const dueToday = home.jobs.filter((task) => task.dueOn === home.today);
  const attentionEmpty = home.attention.revision.length + home.attention.overdue.length + home.attention.soon.length === 0;
  const showPicker = !focus || changing;

  function choose(taskId) {
    if (!taskId || taskId === focus?.id) {
      setChanging(false);
      return;
    }
    const picked = home.choices.find((task) => task.id === taskId);
    if (picked) {
      setFocus({ id: picked.id, title: picked.title, product: picked.product, column: picked.column, columnLabel: picked.columnLabel });
    }
    setChanging(false);
    setNote(null);
    void setWorkFocusAction(taskId).then((result) => {
      if (!result.ok) {
        setFocus(home.focus);
        setNote(result);
        return;
      }
      refreshQuiet(router);
    });
  }

  function sendReview() {
    if (!focus) return;
    const previous = focus;
    setFocus({ ...focus, column: "REVIEW", columnLabel: "Kontrol Ediliyor" });
    setNote(null);
    void sendToReviewAction(focus.id).then((result) => {
      if (!result.ok) {
        setFocus(previous);
        setNote(result);
        return;
      }
      refreshQuiet(router);
    });
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          href="/is-takibi?filtre=geciken"
          label="Geciken işler"
          value={overdue.length}
          hint="Teslim tarihi geçmiş açık kartların"
          icon={<TriangleAlert size={18} />}
          tone="red"
          className="border-red-200"
          valueClassName="text-red-600"
        />
        <StatCard
          href="/is-takibi?filtre=bugun"
          label="Bugün teslim"
          value={dueToday.length}
          hint="Teslim tarihi bugün olan açık kartların"
          icon={<CalendarClock size={18} />}
          tone="orange"
        />
        <StatCard
          href="/is-takibi?filtre=kontrol"
          label="Kontrolde bekleyen"
          value={home.review.length}
          hint="Kontrol Ediliyor sütunundaki kartların"
          icon={<ClipboardCheck size={18} />}
          tone="blue"
        />
        <StatCard
          href="/is-takibi?filtre=revize"
          label="Revizede olan"
          value={home.attention.revision.length}
          hint="Revize Ediliyor sütunundaki kartların"
          icon={<RotateCcw size={18} />}
          tone="violet"
        />
      </div>

      <section className="panel-card mt-4">
        <h2 className="text-base font-semibold">Şu an</h2>
        {showPicker ? (
          <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void choose(choice); }}>
            <label className="min-w-0 flex-1 text-sm text-slate-600">
              Bugün ne üzerinde çalışacaksın?
              {home.choices.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Sana atanmış açık kart yok.</p>
              ) : (
                <select value={choice} onChange={(event) => setChoice(event.target.value)} className="field mt-2" aria-label="Üzerinde çalışılacak kart">
                  {home.choices.map((task) => (
                    <option key={task.id} value={task.id}>{task.title} · {task.product}</option>
                  ))}
                </select>
              )}
            </label>
            {home.choices.length > 0 ? <button type="submit" className="btn-primary">Seç</button> : null}
          </form>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{focus.title}</p>
              <p className="truncate text-sm text-slate-500">{focus.product}{focus.columnLabel ? ` · ${focus.columnLabel}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setChoice(focus.id); setChanging(true); }}>Değiştir</button>
              {focus.column !== "REVIEW" && focus.column !== "DONE" ? (
                <button type="button" className="btn-primary" onClick={() => sendReview()}>Kontrole gönder</button>
              ) : null}
            </div>
          </div>
        )}
        {note && !note.ok ? <p className="mt-2 text-sm text-red-700">{note.message}</p> : null}
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="panel-card">
          <h2 className="text-base font-semibold">İşlerim</h2>
          {home.doingCount > 3 ? (
            <p className="mt-1 text-sm text-slate-500">Yapılıyor sütununda {home.doingCount} kartın var.</p>
          ) : null}
          {home.jobs.length === 0 ? (
            <EmptyState title="Açık işin yok." />
          ) : (
            <ul className="mt-2">
              {home.jobs.map((task) => (
                <TaskRow
                  key={task.id}
                  href={`/is-takibi?kart=${task.id}`}
                  title={task.title}
                  meta={`${task.product} · ${PRIORITY[task.priority] ?? task.priority} · ${task.columnLabel}`}
                  aside={dueLabel(task.dueOn)}
                  tone={task.daysLate > 0 ? "red" : task.dueOn === home.today ? "today" : "plain"}
                />
              ))}
            </ul>
          )}
        </section>
        <section className="panel-card">
          <h2 className="mb-2 text-base font-semibold">Dikkat gerektirenler</h2>
          {attentionEmpty ? (
            <EmptyState title="Acil bir işin yok 🎉" />
          ) : (
            <ul>
              {home.attention.revision.map((task) => (
                <TaskRow
                  key={`rev-${task.id}`}
                  href={`/is-takibi?filtre=revize&kart=${task.id}`}
                  title={task.title}
                  meta="Revize Ediliyor"
                  aside={`${task.openItems} madde açık`}
                  tone="red"
                />
              ))}
              {home.attention.overdue.map((task) => (
                <TaskRow
                  key={`late-${task.id}`}
                  href={`/is-takibi?filtre=geciken&kart=${task.id}`}
                  title={task.title}
                  meta={task.columnLabel}
                  aside={`${task.daysLate} gün geçti`}
                  tone="red"
                />
              ))}
              {home.attention.soon.map((task) => (
                <TaskRow
                  key={`soon-${task.id}`}
                  href={`/is-takibi?kart=${task.id}`}
                  title={task.title}
                  meta={task.product}
                  aside={task.dueOn === home.today ? "Bugün" : "Yarın"}
                  tone="today"
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="panel-card">
          <h2 className="mb-2 text-base font-semibold">Kontrolde bekleyenlerim</h2>
          {home.review.length === 0 ? (
            <EmptyState title="Kontrolde bekleyen kartın yok." />
          ) : (
            <ul>
              {home.review.map((task) => (
                <TaskRow
                  key={task.id}
                  href={`/is-takibi?filtre=kontrol&kart=${task.id}`}
                  title={task.title}
                  meta={task.product}
                  aside={waitLabel(task.reviewHours)}
                  tone={task.reviewHours >= 48 ? "red" : task.reviewHours >= 24 ? "orange" : "plain"}
                />
              ))}
            </ul>
          )}
        </section>
        <section className="panel-card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Megaphone size={18} className="text-slate-500" /> Duyurular</h2>
          </div>
          {home.announcements.length === 0 ? (
            <EmptyState title="Duyuru yok." icon={<Megaphone size={28} />} />
          ) : (
            <ul>
              {home.announcements.map((item) => (
                <li key={item.id} className="border-b border-slate-100 py-3 last:border-b-0">
                  <p className="text-sm text-slate-800">{item.body}</p>
                  <p className="text-xs text-slate-400">{item.createdAt}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <section className="panel-card">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Utensils size={18} className="text-slate-500" /> Yemek</h2>
          {home.meal.ordered ? (
            <p className="text-sm font-semibold text-slate-900">{home.meal.label}</p>
          ) : (
            <>
              <p className="text-sm text-slate-700">Bugünkü yemek siparişini vermedin</p>
              <Link href="/yemek-yonetimi" className="mt-3 inline-block text-sm font-semibold text-[#03624c]">Sipariş sayfası</Link>
            </>
          )}
        </section>
        <section className="panel-card">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><CalendarDays size={18} className="text-slate-500" /> İzin</h2>
          <p className="text-sm font-semibold text-slate-900">
            {home.leave.remaining === null ? "Yıllık izin hakkın henüz açılmadı." : `Kalan yıllık izin: ${home.leave.remaining} gün`}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {home.leave.pending ? `Bekleyen talep: ${home.leave.pending.label} · ${dueLabel(home.leave.pending.startDate)}` : "Bekleyen izin talebin yok."}
          </p>
          <Link href="/izin" className="mt-3 inline-block text-sm font-semibold text-[#03624c]">İzin sayfası</Link>
        </section>
        <StatCard
          label="Bu haftam"
          value={home.week.done}
          hint={home.week.onTimePercent === null ? "Zamanında teslim oranı için bu hafta kapanan kart yok." : `Zamanında teslim: %${home.week.onTimePercent}`}
          icon={<ClipboardCheck size={18} />}
          tone="green"
        />
      </div>

      <section className="panel-card mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bell size={18} className="text-slate-500" />
            Görev bildirimleri
          </h2>
          <Link className="text-sm font-semibold text-[#03624c]" href="/bildirimler">Tüm bildirimler</Link>
        </div>
        {(home.notices ?? []).length === 0 ? (
          <EmptyState title="Görev bildirimi yok." icon={<Bell size={28} />} />
        ) : (
          <ul>
            {home.notices.map((item) => (
              <TaskRow key={item.key} href={item.href} title={item.title} meta={item.body} aside="" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
