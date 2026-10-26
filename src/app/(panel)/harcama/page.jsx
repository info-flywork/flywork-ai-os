import FinanceDesk from "@/components/finance/FinanceDesk";
import FlyworkInvoices from "@/components/finance/FlyworkInvoices";
import SpendDesk from "@/components/finance/SpendDesk";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { istanbulToday } from "@/server/dates";
import { toPublicError } from "@/server/errors";
import { getExpensePage, getInvoicePage } from "@/server/services/finance";

const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function one(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  return picked ? picked : undefined;
}

function todayLabel() {
  const [year, month, day] = istanbulToday().split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${day} ${MONTHS[month - 1]}`;
}

export default async function HarcamaPage({
  searchParams,
}

) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return <p>Harcamalar ve faturalar yalnızca yöneticilere açıktır.</p>;
  }
  const query = await searchParams;
  const flywork = one(query.sekme) === "flywork";

  if (flywork) {
    let data = null;
    let message = "Flywork faturaları okunamadı.";
    try {
      data = await getInvoicePage(user, one(query.ay) ?? istanbulToday().slice(0, 7), "COMPANY");
    } catch (error) {
      message = toPublicError(error).message;
    }
    return (
      <FinanceDesk active="flywork">
        {data ? (
          <FlyworkInvoices
            todayLabel={todayLabel()}
            month={data.month}
            invoices={data.invoices}
            cards={data.cards}
            transfers={data.transfers}
            totals={data.totals}
          />
        ) : <p>{message}</p>}
      </FinanceDesk>
    );
  }

  let data = null;
  let message = "Harcama listesi okunamadı.";
  try {
    data = await getExpensePage(user, "OFFICE", {
      month: one(query.ay),
      year: one(query.yil),
    });
  } catch (error) {
    message = toPublicError(error).message;
  }
  return (
    <FinanceDesk active="ofis">
      {data ? (
        <SpendDesk
          today={istanbulToday()}
          actorId={user.id}
          month={data.month}
          spenders={data.spenders}
          cards={data.cardReport}
          totals={data.monthReport.byCurrency}
          expenses={data.expenses}
        />
      ) : <p>{message}</p>}
    </FinanceDesk>
  );
}
