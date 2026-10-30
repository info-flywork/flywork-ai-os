import Link from "next/link";
import { Bell, CalendarClock, ClipboardCheck, RotateCcw, TriangleAlert } from "lucide-react";
import TeamTime from "@/components/dashboard/TeamTime";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";

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
    <Link
      href="/bildirimler"
      aria-label={label}
      className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
    >
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

export default function TaskHome({ pulse, alertCount }) {
  const admin = pulse.role === "ADMIN";
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

      {admin ? <AdminPulse pulse={pulse} /> : <EmployeePulse pulse={pulse} />}

      <section className="panel-card mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bell size={18} className="text-slate-500" />
            Görev bildirimleri
          </h2>
          <Link className="text-sm font-semibold text-[#03624c]" href="/bildirimler">Tüm bildirimler</Link>
        </div>
        {pulse.notices.length === 0 ? (
          <EmptyState
            title="Görev bildirimi yok."
            body={admin ? "Fatura ve diğer bildirimler Bildirimler sayfasında duruyor." : undefined}
            icon={<Bell size={28} />}
          />
        ) : (
          <ul>
            {pulse.notices.map((notice) => (
              <TaskRow key={notice.key} href={notice.href} title={notice.title} meta={notice.body} aside="" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AdminPulse({ pulse }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          href="/is-takibi?filtre=geciken"
          label="Geciken işler"
          value={pulse.counts.overdue}
          hint="Teslim tarihi geçmiş, bitmemiş kartlar"
          icon={<TriangleAlert size={18} />}
          tone="red"
          className="border-red-200"
          valueClassName="text-red-600"
        />
        <StatCard
          href="/is-takibi?filtre=bugun"
          label="Bugün teslim"
          value={pulse.counts.dueToday}
          hint="Teslim tarihi bugün olan açık kartlar"
          icon={<CalendarClock size={18} />}
          tone="orange"
        />
        <StatCard
          href="/is-takibi?filtre=kontrol"
          label="Kontrolümü bekleyen"
          value={pulse.counts.review}
          hint="Kontrol Ediliyor sütunu"
          icon={<ClipboardCheck size={18} />}
          tone="blue"
        />
        <StatCard
          href="/is-takibi?filtre=revize"
          label="Revizede olan"
          value={pulse.counts.revision}
          hint="Revize Ediliyor sütunu"
          icon={<RotateCcw size={18} />}
          tone="violet"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="panel-card">
          <h2 className="mb-2 text-base font-semibold">Kontrolümü bekleyen işler</h2>
          {pulse.reviewQueue.length === 0 ? (
            <EmptyState title="Kontrol bekleyen iş yok." />
          ) : (
            <ul>
              {pulse.reviewQueue.map((task) => (
                <TaskRow
                  key={task.id}
                  href={`/is-takibi?filtre=kontrol&kart=${task.id}`}
                  title={task.title}
                  meta={`${task.assignees} · ${task.product}`}
                  aside={waitLabel(task.hours)}
                  tone={task.tone}
                />
              ))}
            </ul>
          )}
        </section>
        <section className="panel-card">
          <h2 className="mb-2 text-base font-semibold">Geciken işler</h2>
          {pulse.overdueList.length === 0 ? (
            <EmptyState title="Geciken iş yok." />
          ) : (
            <ul>
              {pulse.overdueList.map((task) => (
                <TaskRow
                  key={task.id}
                  href={`/is-takibi?filtre=geciken&kart=${task.id}`}
                  title={task.title}
                  meta={`${task.assignees} · ${task.column}`}
                  aside={`${task.days} gün`}
                  tone="red"
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {pulse.team.length === 0 ? (
        <section className="panel-card mt-4">
          <h2 className="mb-3 text-base font-semibold">Ekip durumu</h2>
          <EmptyState title="Ekip listesi boş." />
        </section>
      ) : (
        <TeamTime today={pulse.today} people={pulse.team.map((person) => ({ userId: person.userId, name: person.name }))} entries={pulse.timeLog ?? []} />
      )}
    </>
  );
}

function EmployeePulse({ pulse }) {
  return (
    <div className="space-y-4">
      <section className="panel-card border-amber-200 bg-amber-50/60">
        <h2 className="mb-2 text-base font-semibold">Bugün teslim etmem gerekenler</h2>
        {pulse.dueToday.length === 0 ? (
          <EmptyState title="Bugün teslim etmen gereken iş yok." />
        ) : (
          <ul>
            {pulse.dueToday.map((task) => (
              <TaskRow
                key={task.id}
                href={`/is-takibi?filtre=bugun&kart=${task.id}`}
                title={task.title}
                meta={`${task.product} · ${task.column}`}
                aside="Bugün"
                tone="today"
              />
            ))}
          </ul>
        )}
      </section>
      <section className="panel-card">
        <h2 className="mb-2 text-base font-semibold">Bana atanan işler</h2>
        {pulse.assigned.length === 0 ? (
          <EmptyState title="Açık işin yok." />
        ) : (
          <ul>
            {pulse.assigned.map((task) => (
              <TaskRow
                key={task.id}
                href={`/is-takibi?kart=${task.id}`}
                title={task.title}
                meta={`${task.product} · ${task.column}`}
                aside={task.overdue ? `${dueLabel(task.dueOn)} · gecikti` : dueLabel(task.dueOn)}
                tone={task.today ? "today" : task.overdue ? "red" : "plain"}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="panel-card">
        <h2 className="mb-2 text-base font-semibold">Revize bekleyen işlerim</h2>
        {pulse.revision.length === 0 ? (
          <EmptyState title="Revize bekleyen işin yok." />
        ) : (
          <ul>
            {pulse.revision.map((task) => (
              <TaskRow
                key={task.id}
                href={`/is-takibi?filtre=revize&kart=${task.id}`}
                title={task.title}
                meta={task.product}
                aside={task.openItems === 1 ? "1 madde açık" : `${task.openItems} madde açık`}
                tone="orange"
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
