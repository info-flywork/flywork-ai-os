import FlyworkChat from "@/components/chat/FlyworkChat";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { getChatBoard } from "@/server/services/chat";

export const instant = false;

function one(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  return picked ? picked : "";
}

export default async function FlyworkChatPage({ searchParams }) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  const query = await searchParams;
  try {
    const data = await getChatBoard(user, one(query.sohbet));
    return <FlyworkChat data={data} />;
  } catch (error) {
    return <p>{toPublicError(error).message}</p>;
  }
}
