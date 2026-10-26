import AdminLeave, { } from "@/components/leave/AdminLeave";
import EmployeeLeave from "@/components/leave/EmployeeLeave";
import { istanbulToday } from "@/server/dates";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { getAdminLeaveView, getEmployeeLeaveView } from "@/server/services/leave";

const CARD_FROM = "2025-01-01";
const CARD_TO = "2027-12-31";

function leaveTab(value) {
  if (value === "bekleyen" || value === "onaylanan" || value === "talep") {
    return value;
  }
  return "ozet";
}

function filtersFrom() {
  return {
    report: "year",
    period: "2026",
    from: CARD_FROM,
    to: CARD_TO,
  };
}

function todayLabel() {
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(new Date());
  const read = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = read("weekday");
  const label = `${weekday.charAt(0).toLocaleUpperCase("tr")}${weekday.slice(1)}, ${read("day")} ${read("month")}`;
  const month = read("month");
  return label.replace(month, `${month.charAt(0).toLocaleUpperCase("tr")}${month.slice(1)}`);
}

export default async function IzinPage({
  searchParams,
}




) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  const params = await searchParams;

  const ownLeave = await getEmployeeLeaveView(user);
  const requestForm = {
    today: istanbulToday(),
    balance: ownLeave.balance,
    requests: ownLeave.requests,
  };

  if (user.role === "ADMIN") {
    const view = await getAdminLeaveView(user, filtersFrom());
    return (
      <AdminLeave
        requestForm={requestForm}
        canReview={user.approver !== false}
        view={{
          ...view,
          tab: leaveTab(params.sekme),
          todayLabel: todayLabel(),
          selectedEmployeeId: params.calisan,
        }}
      />
    );
  }

  return (
    <EmployeeLeave
      todayLabel={todayLabel()}
      today={requestForm.today}
      requests={requestForm.requests}
    />
  );
}
