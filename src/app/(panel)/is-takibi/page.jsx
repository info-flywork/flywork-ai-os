import WorkBoard from "@/components/work/WorkBoard";
import { WORK_FILTERS } from "@/lib/workPulse";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { getWorkBoard } from "@/server/services/work";
export const instant = false;

function one(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  return picked ? picked : "";
}

export default async function IsTakibiPage({ searchParams }) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  const query = await searchParams;
  const filtre = WORK_FILTERS[one(query.filtre)] ? one(query.filtre) : "";
  const kart = one(query.kart);
  let data = null;
  let message = "İş takibi okunamadı.";
  try {
    const board = await getWorkBoard(user);
    data = { ...board };
    delete data.timeLog;
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!data) return <p>{message}</p>;
  return <WorkBoard data={data} filtre={filtre} kart={kart} />;
}
