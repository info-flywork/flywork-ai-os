import AlertList from "@/components/alerts/AlertList";
import PageHeader from "@/components/ui/PageHeader";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { listAlerts } from "@/server/services/alerts";
export const instant = false;

export default async function AlertsPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
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
  const actionUnread = alerts.filter((alert) => alert.level === "action" && !alert.read).length;

  return (
    <div>
      <PageHeader
        title="Bildirimler"
        description={`Aksiyon gerekenler üstte durur. Okunmamış aksiyon: ${actionUnread}.`}
      />
      <AlertList alerts={alerts} />
    </div>
  );
}
