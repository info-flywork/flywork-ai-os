import BonusDesk from "@/components/bonus/BonusDesk";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { getBonusPage } from "@/server/services/bonus";

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PrimPage({
  searchParams,
}

) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return <p>Primler yalnızca yöneticilere açıktır.</p>;
  }
  const query = await searchParams;
  let data = null;
  let message = "Prim kayıtları okunamadı.";
  try {
    data = await getBonusPage(user, one(query.ay));
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!data) return <p>{message}</p>;
  const editingId = one(query.kayit);
  return (
    <BonusDesk
      key={`${data.month}:${editingId ?? "yeni"}`}
      data={data}
      canManage={user.approver !== false}
      editing={data.awards.find((award) => award.id === editingId) ?? null}
    />
  );
}
