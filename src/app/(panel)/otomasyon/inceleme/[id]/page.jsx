import Link from "next/link";
import { decideReviewAction } from "@/app/(panel)/otomasyon/inceleme/actions";
import { ReviewDecisionButtons } from "@/components/finance/ReviewDecisionButtons";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { moneyConflict } from "@/server/finance/money";
import {
  REVIEW_LABELS,
  REVIEW_STATUS_LABELS,
  reviewIssues,


} from "@/server/finance/reviewRules";
import { getInvoiceReview } from "@/server/services/invoiceReview";

const MESSAGES = {
  onay: "Belge onaylandı ve Flywork/Faturalar klasörüne yüklendi.",
  zaten: "Bu belge daha önce onaylanmış. İkinci kayıt ve ikinci Drive dosyası oluşturulmadı.",
  drive: "Kayıt oluşturuldu. Drive yüklemesi tamamlanmadı. Belge arşivlenmiş sayılmaz.",
  beklet: "Belge inceleme için bekletildi.",
  red: "Belge reddedildi. Fatura kaydı açılmadı.",
  eksik: "Onay engellendi. Zorunlu alanları ve belge türünü tamamlayın.",
  mukerrer: "Mükerrer belge. Yeni fatura kaydı açılmadı.",
  yetki: "Bu işlem yalnızca yöneticilere açıktır.",
  hata: "İşlem tamamlanamadı.",
};

function one(value) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function correctionLines(value) {
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value ).flatMap(([key, change]) => {
    const label = key in REVIEW_LABELS ? REVIEW_LABELS[key ] : key;
    return [`${label}: ${change?.sonra ?? ""}`];
  });
}

export default async function InvoiceReviewPage({
  params,
  searchParams,
}


) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return <p>Fatura incelemesi yalnızca yöneticilere açıktır.</p>;
  }
  const { id } = await params;
  const query = await searchParams;
  const notice = MESSAGES[one(query.durum)] ?? "";
  let review = null;
  let message = "İnceleme okunamadı.";
  try {
    review = await getInvoiceReview(user, id);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!review) {
    return <p>{message}</p>;
  }
  const item = review;
  const locked = user.approver === false || item.status === "APPROVED" || item.status === "REJECTED" || item.kind === "STATEMENT";
  const amountBlocked = reviewIssues(item.draft).length > 0
    || moneyConflict(item.draft.amount, item.draft.tax)
    || item.uncertainFields.some((field) => field === "amount" || field === "tax" || field === "currency" || field === "documentType");
  const mark = (field) => {
    if (item.uncertainFields.includes(field)) {
      return "Belirsiz";
    }
    if (item.missingFields.includes(field) || !item.draft[field]) {
      return field === "tax" ? "" : "Eksik";
    }
    return "";
  };
  return (
    <section className="space-y-4">
      <p className="text-sm"><Link className="underline" href="/otomasyon/inceleme">İnceleme kuyruğu</Link></p>
      <h1 className="page-title">{item.fileName}</h1>
      <p className="text-sm">{REVIEW_STATUS_LABELS[item.status ]}</p>
      {notice ? <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">{notice}</p> : null}
      {item.driveError ? <p className="text-sm">{item.driveError}</p> : null}
      {item.kind === "NOT_INVOICE" ? <p className="text-sm">Bu belge fatura veya fiş olarak kabul edilmedi.</p> : null}
      {item.kind === "STATEMENT" ? <p className="text-sm">Bu belge kredi kartı ekstresi veya banka hesap özeti. Fatura kuyruğundan ayrıldı ve gider değerlendirmesi için saklanıyor.</p> : null}
      <object data={`/api/fatura-inceleme/${item.id}`} type="application/pdf" className="h-[32rem] w-full rounded-2xl border border-slate-200">
        <a className="underline" href={`/api/fatura-inceleme/${item.id}`}>PDF’yi aç</a>
      </object>
      <form action={decideReviewAction} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="id" value={item.id} />
        <label className="text-sm">
          Tedarikçi {mark("vendor") ? <span className="text-amber-700"> · {mark("vendor")}</span> : null}
          <input name="vendor" defaultValue={item.draft.vendor} disabled={locked} className="field mt-1" />
        </label>
        <label className="text-sm">
          Fatura numarası {mark("number") ? <span className="text-amber-700"> · {mark("number")}</span> : null}
          <input name="number" defaultValue={item.draft.number} disabled={locked} className="field mt-1" />
        </label>
        <label className="text-sm">
          Tarih {mark("issuedOn") ? <span className="text-amber-700"> · {mark("issuedOn")}</span> : null}
          <input type="date" name="issuedOn" defaultValue={item.draft.issuedOn} disabled={locked} className="field mt-1" />
        </label>
        <label className="text-sm">
          Tutar {mark("amount") ? <span className="text-amber-700"> · {mark("amount")}</span> : null}
          <input name="amount" defaultValue={item.draft.amount} disabled={locked} className="field mt-1" />
        </label>
        <label className="text-sm">
          Para birimi {mark("currency") ? <span className="text-amber-700"> · {mark("currency")}</span> : null}
          <select name="currency" defaultValue={item.draft.currency} disabled={locked} className="field mt-1">
            <option value="">Seçin</option>
            <option value="TRY">TRY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label className="text-sm">
          Vergi {mark("tax") ? <span className="text-amber-700"> · {mark("tax")}</span> : null}
          <input name="tax" defaultValue={item.draft.tax} disabled={locked} className="field mt-1" />
        </label>
        <label className="text-sm md:col-span-2">
          Belge türü {mark("documentType") ? <span className="text-amber-700"> · {mark("documentType")}</span> : null}
          <select name="documentType" defaultValue={item.draft.documentType} disabled={locked} className="field mt-1">
            <option value="">Seçin</option>
            <option value="INVOICE">Fatura</option>
            <option value="RECEIPT">Fiş</option>
          </select>
        </label>
        {amountBlocked ? <p className="text-sm text-amber-700 md:col-span-2">Tutar, vergi, para birimi veya belge türü onay için hazır değil.</p> : null}
        {locked ? null : (
          <ReviewDecisionButtons amountBlocked={amountBlocked} retry={item.status === "DRIVE_FAILED"} />
        )}
      </form>
      <section>
        <h2 className="section-title">İşlem kaydı</h2>
        {item.audits.length === 0 ? <p className="text-sm">Henüz işlem yok.</p> : (
          <ul className="space-y-2 text-sm">
            {item.audits.map((audit) => (
              <li key={audit.id}>
                <div>{audit.createdAt} · {audit.actor} · {audit.action}</div>
                {correctionLines(audit.corrections).map((line) => <div key={line}>{line}</div>)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
