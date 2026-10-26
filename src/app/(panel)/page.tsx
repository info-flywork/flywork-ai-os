import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Cpu,
  FileText,
  Receipt,
  XCircle,
} from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { requireUser } from "@/server/auth/session";
import { getDashboardSummary } from "@/server/dashboard/summary";
import { toPublicError } from "@/server/errors";
import { listAlerts } from "@/server/services/alerts";
import { syncTechnologyNotices } from "@/server/services/technology";
import { TECHNOLOGY_DRAFTS } from "@/server/technology/drafts";

const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "Yıllık izin",
  SICK: "Rapor",
  EXCUSE: "Mazeret",
  UNPAID: "Ücretsiz izin",
};

const RUN_TONE = {
  SUCCEEDED: "ok",
  FAILED: "bad",
  RUNNING: "info",
  WAITING_CONNECTION: "warn",
} as const;

const RUN_LABELS: Record<string, string> = {
  RUNNING: "Çalışıyor",
  SUCCEEDED: "Başarılı",
  FAILED: "Hatalı",
  WAITING_CONNECTION: "Bağlantı bekleniyor",
};

function alertIcon(key: string) {
  if (key.startsWith("invoice.review:")) return <FileText size={18} />;
  if (key.startsWith("leave.request:")) return <CalendarDays size={18} />;
  if (key.startsWith("technology.draft:")) return <Cpu size={18} />;
  return <Bell size={18} />;
}

function formatMoney(amount: string) {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function currencyName(code: string) {
  return code === "TRY" ? "TL" : code;
}

function todayLabel() {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "long",
  }).format(new Date());
}

export default async function DashboardPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    redirect("/yemek-yonetimi");
  }
  let summary: Awaited<ReturnType<typeof getDashboardSummary>> | null = null;
  let message = "Özet okunamadı.";
  try {
    if (user.role === "ADMIN") {
      await syncTechnologyNotices(user);
    }
    summary = await getDashboardSummary(user);
  } catch (error) {
    message = toPublicError(error).message;
  }

  if (!summary) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <p>{message}</p>
      </div>
    );
  }

  const company = summary.scope === "company";
  let alertCount = 0;
  let alerts: Awaited<ReturnType<typeof listAlerts>> = [];
  try {
    const monthAlerts = await listAlerts(user, new Date(), summary.month);
    alerts = monthAlerts.slice(0, 6);
    alertCount = monthAlerts.filter((alert) => !alert.read).length;
  } catch {
    alertCount = 0;
  }
  const expenseRows = summary.monthlyExpenses.filter((row) => row.count > 0);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={company ? undefined : "Yalnızca sizin kayıtlarınız."}
        actions={<p className="text-sm text-slate-400">{todayLabel()}</p>}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          href="/harcama"
          label={`${summary.month} giderleri`}
          value={
            expenseRows.length === 0 ? (
              "0 kayıt"
            ) : (
              <span className="flex flex-col gap-2.5">
                {expenseRows.map((row) => (
                  <span key={row.currency}>
                    {formatMoney(row.total)} {currencyName(row.currency)}
                  </span>
                ))}
              </span>
            )
          }
          hint="Yalnızca bu ayın onaylı ve ödenen kayıtları"
          icon={<Receipt size={18} />}
          tone="green"
        />
        {company && summary.invoicesPending !== null ? (
          <StatCard
            href="/otomasyon/inceleme"
            label="İnceleme bekleyen"
            value={`${summary.invoicesPending} fatura`}
            hint="Yalnızca bu ay. Ekstreler bu sayıda değildir"
            icon={<FileText size={18} />}
            tone="blue"
          />
        ) : null}
        <StatCard
          href="/izin"
          label="Bekleyen izin"
          value={`${summary.leave.pending} talep`}
          hint={`Bugün izinde: ${summary.leave.awayToday}`}
          icon={<CalendarDays size={18} />}
          tone="violet"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <section className="panel-card xl:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Bell size={18} className="text-slate-500" />
              Bildirimler
              {alertCount > 0 ? <span className="rounded-full bg-[#ff5a5f] px-1.5 text-xs text-white">{alertCount}</span> : null}
            </h2>
            <Link className="text-sm font-semibold text-[#03624c]" href="/bildirimler">Tümünü gör</Link>
          </div>
          {alerts.length === 0 ? <EmptyState title="Açık bildirim yok." icon={<Bell size={28} />} /> : (
            <ul>
              {alerts.map((alert) => (
                <li key={alert.key} className="border-b border-slate-100 last:border-b-0">
                  <Link href={alert.href} className="flex items-center gap-3 py-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">{alertIcon(alert.key)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{alert.title}</span>
                      <span className="block truncate text-sm text-slate-500">{alert.body}</span>
                    </span>
                    <span className={`h-2.5 w-2.5 rounded-full ${alert.read ? "bg-sky-400" : "bg-[#ff5a5f]"}`} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-card xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{summary.month} giderleri</h2>
            <Link className="text-sm font-semibold text-[#03624c]" href="/harcama">Detayı gör</Link>
          </div>
          {expenseRows.length === 0 ? (
            <p className="text-3xl font-semibold tracking-tight">0 kayıt</p>
          ) : (
            <ul className="space-y-2.5">
              {expenseRows.map((row) => (
                <li key={row.currency} className="text-2xl font-semibold tracking-tight">{formatMoney(row.total)} {currencyName(row.currency)}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-sm text-slate-400">Yalnızca bu ay. Para birimleri birbirine çevrilmez.</p>
          <ul className="mt-5 space-y-3 text-sm">
            {summary.monthlyExpenses.filter((row) => row.count > 0).map((row) => (
              <li key={row.currency} className="flex items-center justify-between">
                <span className="text-slate-500">{currencyName(row.currency)}</span>
                <span className="tabular-nums">{formatMoney(row.total)} · {row.count} kayıt</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className={`mt-4 grid grid-cols-1 gap-4 ${company ? "lg:grid-cols-2" : ""}`}>
        <section className="panel-card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarDays size={18} /> Bekleyen izinler</h2>
            <Link className="text-sm font-semibold text-[#03624c]" href="/izin">Tümünü gör</Link>
          </div>
          {summary.leave.requests.length === 0 ? (
            <EmptyState
              title={`${summary.leave.pending} talep bekliyor`}
              body="Bekleyen izin talebi yok."
              icon={<CalendarDays size={32} />}
              action={<Link className="btn-primary" href="/izin">Yeni izin talebi</Link>}
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {summary.leave.requests.map((request) => (
                <li key={request.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                  <span>{request.name} · {LEAVE_LABELS[request.type] ?? request.type}</span>
                  <span className="text-slate-500">{request.startDate}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {company ? (
          <section className="panel-card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Yaklaşan yenilemeler</h2>
              <Link className="text-sm font-semibold text-[#03624c]" href="/teknoloji">Tümünü gör</Link>
            </div>
            {summary.upcomingRenewals.length === 0 ? (
              <p className="text-sm text-slate-500">Önümüzdeki 30 günde kayıtlı yenileme yok.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {summary.upcomingRenewals.map((item) => (
                  <li key={item.id}>{item.name}: {item.renewsOn} ({item.daysUntil} gün)</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-sm text-slate-500">Geciken ödeme: {summary.overdueRenewals}.</p>
            <ul className="mt-3 space-y-2">
              {TECHNOLOGY_DRAFTS.map((draft) => (
                <li key={draft.id}>
                  <Link href={`/teknoloji?taslak=${draft.id}`} className="flex items-center justify-between rounded-xl px-1 py-2 hover:bg-slate-50">
                    <span>
                      <span className="block text-sm font-semibold">{draft.name}</span>
                      <span className="block text-xs text-slate-500">{draft.known[0]}</span>
                    </span>
                    <StatusBadge tone="warn">Taslak</StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {company && summary.recentRuns ? (
        <section className="panel-card mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Son otomasyon çalışmaları</h2>
            <Link className="text-sm font-semibold text-[#03624c]" href="/otomasyon">Tümünü gör</Link>
          </div>
          {summary.recentRuns.length === 0 ? <EmptyState title="Henüz çalışma yok." /> : (
            <ul>
              {summary.recentRuns.map((run) => (
                <li key={run.id} className="flex flex-col gap-2 border-b border-slate-100 py-3 last:border-b-0 sm:flex-row sm:items-center">
                  {run.state === "FAILED" ? <XCircle className="text-red-500" size={18} /> : <CheckCircle2 className="text-[#03624c]" size={18} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{run.jobName}</p>
                    <p className="truncate text-sm text-slate-500">{run.error ?? run.summary}</p>
                  </div>
                  <p className="text-sm text-slate-400">{run.startedAt}</p>
                  <StatusBadge tone={RUN_TONE[run.state as keyof typeof RUN_TONE] ?? "neutral"}>{RUN_LABELS[run.state] ?? run.state}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
