import TechnologyBoard from "@/components/technology/TechnologyBoard";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { listPaidSubscriptions } from "@/server/services/paidSubscriptions";
import { getTechnologyPage } from "@/server/services/technology";
import { technologyDraft } from "@/server/technology/drafts";

function one(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  return picked ? picked : undefined;
}

export default async function TeknolojiPage({
  searchParams,
}

) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return <p>Abonelikler yalnızca yöneticilere açıktır.</p>;
  }
  const query = await searchParams;
  let data = null;
  let payments = [];
  let message = "Abonelik kayıtları okunamadı.";
  try {
    [data, payments] = await Promise.all([
      getTechnologyPage(user, {
        query: one(query.ara),
        kind: one(query.tur),
        status: one(query.durum),
        currency: one(query.para),
        month: one(query.ay),
      }),
      listPaidSubscriptions(user),
    ]);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!data) {
    return <p>{message}</p>;
  }
  const editingId = one(query.kayit);
  const paymentId = one(query.odeme);
  return (
    <TechnologyBoard
      payments={payments}
      data={data}
      editing={paymentId ? null : data.subscriptions.find((item) => item.id === editingId) ?? null}
      editingPayment={payments.find((item) => item.id === paymentId) ?? null}
      draft={editingId || paymentId ? null : technologyDraft(one(query.taslak))}
    />
  );
}
