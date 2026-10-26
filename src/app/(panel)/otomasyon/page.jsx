import { setJobStateAction, decideAgentActionAction, disconnectGoogleAction, previewInvoiceReaderAction, runGoogleJobAction } from "@/app/(panel)/otomasyon/actions";
import Link from "next/link";
import TelegramPairing from "@/components/automation/TelegramPairing";
import Notice from "@/components/Notice";
import { redirectEmployeeFromAdminPages, redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { REVIEW_STATUS_LABELS } from "@/server/finance/reviewRules";
import { getAutomationPage } from "@/server/services/automation";

const STATE_LABELS = {
  ACTIVE: "Aktif",
  PAUSED: "Duraklatıldı",
  WAITING_CONNECTION: "Bağlantı bekleniyor",
  RUNNING: "Çalışıyor",
  SUCCEEDED: "Başarılı",
  FAILED: "Hatalı",
} ;

const WEEKDAYS = ["", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const GOOGLE_MESSAGES = {
  baglandi: "Google hesabı bağlandı. Gmail salt okunur ve Drive dosya izni kaydedildi.",
  red: "Google bağlantısı iptal edildi. Posta okunmadı.",
  durum: "Bağlantı doğrulanamadı. Yeniden deneyin. Posta okunmadı.",
  hata: "Google bağlantısı tamamlanamadı. Posta okunmadı ve dosya yüklenmedi.",
  ayar: "Google kimlik bilgileri eksik. Bağlantı kurulmadı.",
  yetki: "Bu işlem yalnızca yöneticilere açıktır.",
};

function scheduleLabel(weekdays, hour, minute) {
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (weekdays.length === 0) {
    return `Her gün ${clock}`;
  }
  return `${weekdays.map((day) => WEEKDAYS[day] ?? String(day)).join(", ")} ${clock}`;
}

export default async function OtomasyonPage({
  searchParams,
}

) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  redirectEmployeeFromAdminPages(user);
  if (user.role !== "ADMIN") {
    return <p>Otomasyon merkezi yalnızca yöneticilere açıktır.</p>;
  }
  const query = await searchParams;
  const googleMessage = query.google ? GOOGLE_MESSAGES[query.google] : undefined;
  let data = null;
  let message = "Otomasyon kayıtları okunamadı.";
  try {
    data = await getAutomationPage(user);
  } catch (error) {
    message = toPublicError(error).message;
  }
  if (!data) {
    return <p>{message}</p>;
  }
  const googleMissing = data.google.missing.join(", ");
  const aiMissing = data.connections.ai.missing.join(", ");
  const google = data.google;
  const jobs = data.jobs.filter((job) => job.key !== "gmail.morning" && job.key !== "gmail.evening");
  const runs = data.runs.filter((run) => run.jobKey !== "gmail.morning" && run.jobKey !== "gmail.evening");

  return (
    <div className="space-y-6">
      <h1 className="page-title">Otomasyon</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map((job) => (
          <article key={job.id} className="panel-card">
            <p className="text-sm text-slate-500">{job.name}</p>
            <p className="mt-2 text-2xl font-semibold">{scheduleLabel(job.weekdays, job.hour, job.minute)}</p>
            <p className="mt-2 text-sm">{STATE_LABELS[job.state]}</p>
          </article>
        ))}
      </div>
      <section className="panel-card text-sm">
        <h2 className="section-title">Worker</h2>
        <p>Görevler panel kapalıyken de çalışır. Ayrı bir terminalde şu komut açık kalmalıdır:</p>
        <p className="mt-2 font-mono">{data.startCommand}</p>
        <p className="mt-2">Saat dilimi Europe/Istanbul. Worker kapanırsa görev kayıtları veritabanında kalır. Yeniden açılınca zamanı gelmiş tek pencereyi bir kez çalıştırır.</p>
      </section>
      {googleMessage ? <Notice tone={query.google === "baglandi" ? "ok" : "err"}>{googleMessage}</Notice> : null}
      <section className={`panel-card text-sm ${google.connected ? "border-[#03624c]/30" : "border-amber-200 bg-amber-50"}`}>
        <h2 className="section-title">Google hesabı</h2>
        {google.connected ? (
          <p>Bağlı hesap: {google.accountEmail}. Gmail salt okunur. Drive yalnızca bu uygulamanın oluşturduğu dosyaları görür.</p>
        ) : (
          <p>
            {google.status === "ERROR"
              ? `Bağlantı hatası. ${google.lastError ?? "Hesabı yeniden bağlayın."} Posta okunmadı ve dosya yüklenmedi.`
              : "Google hesabı bağlı değil. Posta okunmadı ve dosya yüklenmedi."}
          </p>
        )}
        <p className="mt-2">Yönlendirme adresi: {google.redirectUri ?? "GOOGLE_REDIRECT_URI tanımlı değil."}</p>
        <p className="mt-2">Adresin yolu {google.redirectPath} olmalı. İzinler: {google.gmailScope} ve {google.driveScope}.</p>
        {googleMissing ? <p className="mt-2">Eksik: {googleMissing}.</p> : null}
        <p className="mt-2">
          {data.connections.ai.configured
            ? `AI belge okuyucu bağlı. Sağlayıcı: ${data.connections.ai.provider}.`
            : `AI belge okuyucu: Bağlantı bekleniyor. Eksik: ${aiMissing}.`}
          {" "}E-posta gönderimi yok. Telegram gönderimi {data.telegram.delivery === "live" ? "açık" : "kapalı"}.
        </p>
        <p className="mt-2">E-posta gönderme, silme ve değiştirme bu sürümde çalışmaz.</p>
        <div className="mt-3 flex flex-wrap gap-4">
          {google.credentialsConfigured && !google.connected ? (
            <a href="/api/google/oauth/start" className="underline">Google hesabını bağla</a>
          ) : null}
          {google.connected || google.status === "ERROR" ? (
            <form action={disconnectGoogleAction}>
              <button className="btn-secondary">Bağlantıyı kes</button>
            </form>
          ) : null}
          <form action={runGoogleJobAction}>
            <input type="hidden" name="key" value="invoice.morning" />
            <button className="btn-primary">Fatura taramasını şimdi çalıştır</button>
          </form>
        </div>
      </section>
      <section className="panel-card text-sm">
        <h2 className="section-title">Telegram</h2>
        <p>{data.telegram.configured ? "Bot tokenı tanımlı." : "Bot tokenı tanımlı değil."} Gönderim {data.telegram.delivery === "live" ? "açık" : "kapalı"}. Telegram erişilemezse paneldeki işlemler sürer.</p>
        <p className="mt-2">Webhook bağlanmadan bot mesaj almaz. Token yalnızca sunucu ortamından okunur.</p>
        <TelegramPairing linked={data.telegram.linked} />
      </section>
      <section className="panel-card text-sm">
        <h2 className="section-title">Son fatura taraması</h2>
        {data.invoicePreview ? (
          <>
            <p>Son tarama: {data.invoicePreview.scannedAt ?? data.invoiceRun?.scannedAt ?? "zaman yok"}.</p>
            <p className="mt-2">Bulunan belge {data.invoicePreview.found}, yeni inceleme {data.invoicePreview.queued}, mükerrer {data.invoicePreview.duplicates}, elenen {data.invoicePreview.rejected}.</p>
            <p className="mt-2">{data.invoicePreview.errors.length > 0 ? `Hatalar: ${data.invoicePreview.errors.join(" ")}` : "Hata yok."}</p>
          </>
        ) : (
          <p>{data.invoiceRun ? `${data.invoiceRun.scannedAt}. ${data.invoiceRun.error ?? data.invoiceRun.summary}` : "Henüz fatura taraması yok."}</p>
        )}
        <p className="mt-2">Otomatik onay yok. {data.invoicePreview?.driveUploaded ? "Bu turda dosya Drive'a yüklendi." : "Drive'a dosya yüklenmedi."}</p>
        {data.runs.some((run) => run.state === "FAILED") ? (
          <p className="mt-2"><Link className="underline" href="/bildirimler">Başarısız çalışmalar bildirim merkezinde durur.</Link></p>
        ) : (
          <p className="mt-2">Başarısız çalışma yok.</p>
        )}
      </section>

      <div className="space-y-3 md:hidden">
        {jobs.map((job) => (
          <article key={job.id} className="panel-card p-3 text-sm">
            <div className="font-medium">{job.name}</div>
            <div className="text-gray-600">{job.key}</div>
            <p className="mt-1">{scheduleLabel(job.weekdays, job.hour, job.minute)}</p>
            <p>{STATE_LABELS[job.state]} · sonraki {job.nextRunAt}</p>
            <p>{job.lastSuccessAt ? `Başarı ${job.lastSuccessAt}` : "Başarılı çalışma yok"}</p>
            {job.lastError ? <p>{job.lastError}</p> : null}
            <form action={setJobStateAction} className="mt-2">
              <input type="hidden" name="jobId" value={job.id} />
              {job.state === "PAUSED" ? (
                <button name="state" value="ACTIVE" className="btn-secondary">Sürdür</button>
              ) : (
                <button name="state" value="PAUSED" className="btn-secondary">Duraklat</button>
              )}
            </form>
          </article>
        ))}
      </div>
      <div className="panel-card hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2">Görev</th>
              <th className="p-2">Zaman</th>
              <th className="p-2">Durum</th>
              <th className="p-2">Sonraki</th>
              <th className="p-2">Son sonuç</th>
              <th className="p-2">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t align-top">
                <td className="p-2">
                  <div className="font-medium">{job.name}</div>
                  <div className="text-gray-600">{job.key}</div>
                </td>
                <td className="p-2">{scheduleLabel(job.weekdays, job.hour, job.minute)}</td>
                <td className="p-2">{STATE_LABELS[job.state]}</td>
                <td className="p-2">{job.nextRunAt}</td>
                <td className="p-2">
                  <div>{job.lastSuccessAt ? `Başarı ${job.lastSuccessAt}` : "Başarılı çalışma yok"}</div>
                  <div>{job.lastError ?? ""}</div>
                  <div>Deneme {job.retryCount}/{job.maxRetries}</div>
                </td>
                <td className="p-2">
                  <form action={setJobStateAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    {job.state === "PAUSED" ? (
                      <button name="state" value="ACTIVE" className="btn-secondary">Sürdür</button>
                    ) : (
                      <button name="state" value="PAUSED" className="btn-secondary">Duraklat</button>
                    )}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="panel-card">
        <h2 className="section-title">Çalışma geçmişi</h2>
        {runs.length === 0 ? <p className="text-sm">Henüz çalışma yok.</p> : (
          <ul className="space-y-2 text-sm">
            {runs.map((run) => (
              <li key={run.id}>
                {run.startedAt} · {run.jobName} · {run.windowKey} · deneme {run.attempt} · {STATE_LABELS[run.state]}
                <div className="text-gray-600">{run.error ?? run.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-card border-[#03624c]/30">
        <h2 className="section-title">Fatura inceleme</h2>
        <p className="mb-2 text-sm">Her belge ayrı açılır. Onay, red ve bekletme yalnızca yönetici ekranından yapılır. Onaylanmadan fatura kaydı ve Drive yüklemesi yapılmaz.</p>
        {data.statementCount > 0 ? <p className="mb-2 text-sm">Ekstre olarak saklanan {data.statementCount} belge fatura kuyruğunda değil. Gider kaydı açılmadı.</p> : null}
        <p className="mb-3 text-sm"><Link className="underline" href="/otomasyon/inceleme">İnceleme kuyruğu</Link></p>
        <form action={previewInvoiceReaderAction} className="mb-3">
          <button className="btn-secondary">Son iki iletinin önizlemesini yenile</button>
        </form>
        {data.invoiceReviews.length === 0 ? (
          data.notices.filter((notice) => notice.title === "Fatura önizlemesi").length === 0 ? (
            <p className="text-sm">Önizleme yok.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {data.notices.filter((notice) => notice.title === "Fatura önizlemesi").map((notice) => (
                <li key={notice.id}>
                  <div className="text-gray-600">{notice.createdAt}</div>
                  <div className="whitespace-pre-wrap">{notice.body}</div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul className="space-y-2 text-sm">
            {data.invoiceReviews.map((review) => (
              <li key={review.id}>
                <Link className="underline" href={`/otomasyon/inceleme/${review.id}`}>
                  {review.vendor || "Tedarikçi eksik"} · {review.number || "numara eksik"}
                </Link>
                <span> · {REVIEW_STATUS_LABELS[review.status ]}</span>
                {review.missingFields.length > 0 ? <span> · Eksik: {review.missingFields.length}</span> : null}
                {review.uncertainFields.length > 0 ? <span> · Belirsiz: {review.uncertainFields.length}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-card">
        <h2 className="section-title">Panel bildirimleri</h2>
        {data.notices.filter((notice) => notice.title !== "Fatura önizlemesi").length === 0 ? <p className="text-sm">Bildirim yok.</p> : (
          <ul className="space-y-2 text-sm">
            {data.notices.filter((notice) => notice.title !== "Fatura önizlemesi").map((notice) => (
              <li key={notice.id}>
                {notice.createdAt} · {notice.title}
                <div className="whitespace-pre-wrap">{notice.body}</div>
                <div className="text-gray-600">{notice.delivered ? "Gönderildi" : "Yalnızca panel. Dışarı gönderilmedi."}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-card">
        <h2 className="section-title">Gmail onay kuyruğu</h2>
        <p className="mb-2 text-sm">Gönderme ve silme onaylansa da çalıştırılmaz. Gmail izni salt okunur.</p>
        {data.actions.length === 0 ? <p className="text-sm">Onay bekleyen işlem yok.</p> : (
          <ul className="space-y-3 text-sm">
            {data.actions.map((action) => (
              <li key={action.id} className="panel-card p-3">
                <div>{action.kind === "GMAIL_SEND" ? "E-posta gönder" : "E-posta sil"} · {action.state}</div>
                <div>{action.summary}</div>
                {action.decisionNote ? <Notice tone={action.state === "REJECTED" || action.state === "BLOCKED" ? "err" : "ok"}>{action.decisionNote}</Notice> : null}
                {action.state === "PENDING" ? (
                  <form action={decideAgentActionAction} className="mt-2 flex gap-3">
                    <input type="hidden" name="actionId" value={action.id} />
                    <button name="decision" value="APPROVED" className="btn-primary">Onayla</button>
                    <button name="decision" value="REJECTED" className="btn-secondary">Reddet</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
