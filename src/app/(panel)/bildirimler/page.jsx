import { markAllAlertsReadAction } from "@/app/(panel)/bildirimler/actions";
import AlertList from "@/components/alerts/AlertList";
import PageHeader from "@/components/ui/PageHeader";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { listAlerts } from "@/server/services/alerts";

export default async function AlertsPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  let alerts = null;
  let message = "Bildirimler okunamadı.";
  try {
    alerts = await listAlerts(user);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!alerts) {
    return <p>{message}</p>;
  }
  const unread = alerts.filter((alert) => !alert.read).length;
  const company = user.role === "ADMIN";

  return (
    <div>
      <PageHeader
        title="Bildirimler"
        description={company
          ? `Fatura, izin, yenileme, otomasyon ve taslak hizmet uyarıları. Okunmamış: ${unread}.`
          : `Bekleyen izin talepleriniz. Okunmamış: ${unread}.`}
        actions={unread > 0 ? (
          <form action={markAllAlertsReadAction}>
            <button className="btn-secondary">Tümünü okundu işaretle</button>
          </form>
        ) : null}
      />
      <AlertList alerts={alerts} />
    </div>
  );
}
