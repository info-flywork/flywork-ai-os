import WorkBoard from "@/components/work/WorkBoard";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { getWorkBoard } from "@/server/services/work";

export default async function IsTakibiPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  let data: Awaited<ReturnType<typeof getWorkBoard>> | null = null;
  let message = "İş takibi okunamadı.";
  try {
    data = await getWorkBoard(user);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!data) return <p>{message}</p>;
  return <WorkBoard data={data} />;
}
