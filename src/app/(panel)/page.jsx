import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  FileText,
  Receipt,
  XCircle,
} from "lucide-react";
import DashboardRefresh from "@/components/dashboard/DashboardRefresh";
import TaskHome from "@/components/dashboard/TaskHome";
import EmptyState from "@/components/ui/EmptyState";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { getDashboardSummary } from "@/server/dashboard/summary";
import { getWorkPulse } from "@/server/dashboard/workPulse";
import { toPublicError } from "@/server/errors";
import { listAlerts } from "@/server/services/alerts";
import { syncTechnologyNotices } from "@/server/services/technology";
import { TECHNOLOGY_DRAFTS } from "@/server/technology/drafts";

export const instant = false;

const LEAVE_LABELS = {
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
};

const RUN_LABELS = {
  RUNNING: "Çalışıyor",
  SUCCEEDED: "Başarılı",
  FAILED: "Hatalı",
  WAITING_CONNECTION: "Bağlantı bekleniyor",
};

function formatMoney(amount) {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function currencyName(code) {
  return code === "TRY" ? "TL" : code;
}

export default async function DashboardPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  const admin = user.role === "ADMIN";
  const [pulseResult, alertResult, summaryResult] = await Promise.all([
    getWorkPulse(user).then((value) => ({ ok: true, value })).catch((error) => ({ ok: false, message: toPublicError(error).message })),
    listAlerts(user).then((value) => ({ ok: true, value })).catch(() => ({ ok: false })),
    admin
      ? Promise.all([
          syncTechnologyNotices(user).catch(() => undefined),
          getDashboardSummary(user),
        ]).then(([, value]) => ({ ok: true, value })).catch((error) => ({ ok: false, message: toPublicError(error).message }))
      : Promise.resolve(null),
  ]);
  const pulse = pulseResult.ok ? pulseResult.value : null;
  const pulseMessage = pulseResult.ok ? "" : pulseResult.message;
  const alertCount = alertResult.ok
    ? alertResult.value.filter((alert) => alert.level === "action" && !alert.read).length
    : 0;
  const summary = summaryResult?.ok ? summaryResult.value : null;
  const summaryMessage = summaryResult && !summaryResult.ok ? summaryResult.message : "Finans özeti okunamadı.";

  return (
    <div>
      <DashboardRefresh />
      {pulse ? <TaskHome pulse={pulse} alertCount={alertCount} /> : <p>{pulseMessage}</p>}
      {user.role === "ADMIN" ? <FinanceOps summary={summary} message={summaryMessage} /> : null}
    </div>
  );
}

function FinanceOps({ summary, message }) {
  if (!summary) {
    return (
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Finans ve Operasyon</h2>
        <p>{message}</p>
      </section>
    );
  }
  const company = summary.scope === "company";
  const expenseRows = summary.monthlyExpenses.filter((row) => row.count > 0);
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Finans ve Operasyon</h2>
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
        <section className="panel-card xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">{summary.month} giderleri</h3>
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
        </section>
        <section className="panel-card xl:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold"><CalendarDays size={18} /> Bekleyen izinler</h3>
            <Link className="text-sm font-semibold text-[#03624c]" href="/izin">Tümünü gör</Link>
          </div>
          {summary.leave.requests.length === 0 ? (
            <EmptyState title="Bekleyen izin talebi yok." icon={<CalendarDays size={32} />} />
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
      </div>

      {company ? (
        <section className="panel-card mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-semibold">Yaklaşan yenilemeler</h3>
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

      {company && summary.recentRuns ? (
        <section className="panel-card mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-semibold">Son otomasyon çalışmaları</h3>
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
                  <StatusBadge tone={RUN_TONE[run.state] ?? "neutral"}>{RUN_LABELS[run.state] ?? run.state}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}
