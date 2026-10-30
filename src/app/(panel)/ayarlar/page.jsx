import { saveInvoiceAutoRuleAction } from "@/app/(panel)/ayarlar/actions";
import PageHeader from "@/components/ui/PageHeader";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { getInvoiceAutoRule } from "@/server/services/invoiceAutoRule";
import AnnouncementForm from "@/components/settings/AnnouncementForm";
import InvoiceAutoRuleForm from "@/components/settings/InvoiceAutoRuleForm";
import { listRecentAnnouncements } from "@/server/services/announcements";

export const instant = false;

export default async function SettingsPage() {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  let rule = null;
  let announcements = [];
  let message = "Ayarlar okunamadı.";
  try {
    [rule, announcements] = await Promise.all([
      getInvoiceAutoRule(),
      listRecentAnnouncements(user),
    ]);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!rule) {
    return <p>{message}</p>;
  }

  return (
    <div>
      <PageHeader
        title="Ayarlar"
        description="Otomatik fatura onayı varsayılan olarak kapalıdır. Açıldığında seçilen tedarikçilerden, yazdığınız tutarın altındaki faturalar onaylanır ve bilgi bildirimi olarak düşer."
      />
      <InvoiceAutoRuleForm action={saveInvoiceAutoRuleAction} rule={rule} />
      <AnnouncementForm items={announcements} />
    </div>
  );
}
