import Link from "next/link";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { REVIEW_STATUS_LABELS } from "@/server/finance/reviewRules";
import { listInvoiceReviews } from "@/server/services/invoiceReview";

export default async function InvoiceReviewListPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return <p>Fatura incelemesi yalnızca yöneticilere açıktır.</p>;
  }
  let reviews = null;
  let message = "İncelemeler okunamadı.";
  try {
    reviews = await listInvoiceReviews(user);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!reviews) {
    return <p>{message}</p>;
  }
  return (
    <section className="space-y-4">
      <h1 className="page-title">Fatura inceleme</h1>
      <p className="text-sm">Eksik alanlar işaretlidir. Onay, zorunlu alanlar dolmadan kayıt oluşturmaz. Gider kaydı bu ekrandan açılmaz.</p>
      {reviews.length === 0 ? (
        <p className="text-sm">İnceleme bekleyen belge yok.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {reviews.map((review) => (
            <li key={review.id} className="panel-card p-3">
              <Link className="underline" href={`/otomasyon/inceleme/${review.id}`}>
                {review.vendor || "Tedarikçi eksik"} · {review.number || "Belge numarası eksik"}
              </Link>
              <div>{REVIEW_STATUS_LABELS[review.status ]}</div>
              {review.missingFields.length > 0 ? <div>Eksik alan: {review.missingFields.length}</div> : null}
              {review.uncertainFields.length > 0 ? <div>Belirsiz alan: {review.uncertainFields.length}</div> : null}
              {review.driveError ? <div>{review.driveError}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
