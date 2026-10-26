import FeedbackDesk from "@/components/feedback/FeedbackDesk";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { listFeedback } from "@/server/services/feedback";

export default async function FeedbackPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  if (user.role !== "ADMIN") {
    return <FeedbackDesk data={{ admin: false, notes: [] }} canReview={false} />;
  }
  let data = null;
  let message = "Kayıtlar okunamadı.";
  try {
    data = await listFeedback(user);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!data) return <p>{message}</p>;
  return <FeedbackDesk data={data} canReview={user.approver !== false} />;
}
