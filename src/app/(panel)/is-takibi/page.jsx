import WorkActivity from "@/components/work/WorkActivity";
import WorkBoard from "@/components/work/WorkBoard";
import WorkDesk from "@/components/work/WorkDesk";
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
  const sekme = one(query.sekme) === "calisma" ? "calisma" : "kartlar";
  const filtre = WORK_FILTERS[one(query.filtre)] ? one(query.filtre) : "";
  const kart = one(query.kart);
  let data = null;
  let message = "İş takibi okunamadı.";
  try {
    data = await getWorkBoard(user);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!data) return <p>{message}</p>;
  if (sekme === "calisma") {
    const previewEmployee = user.role === "ADMIN" && one(query.gorunum) === "calisan";
    return (
      <WorkDesk active="calisma">
        <WorkActivity data={previewEmployee ? { ...data, viewerRole: "EMPLOYEE" } : data} />
      </WorkDesk>
    );
  }
  const board = { ...data };
  delete board.timeLog;
  return (
    <WorkDesk active="kartlar">
      <WorkBoard data={board} filtre={filtre} kart={kart} />
    </WorkDesk>
  );
}
