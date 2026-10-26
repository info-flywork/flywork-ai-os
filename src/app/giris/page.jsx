import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { landingPath } from "@/lib/safeNextPath";
import { readCurrentUser } from "@/server/auth/session";
import { withDatabase } from "@/server/db";

async function LoginScreen({
  searchParams,
}

) {
  const user = await readCurrentUser();
  const params = await searchParams;
  if (user) {
    redirect(landingPath(user, params.next));
  }

  const adminCount = await withDatabase((db) =>
    db.user.count({ where: { role: "ADMIN", active: true } }),
  );

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <section className="flex flex-col justify-center bg-[#03624c] px-8 py-12 text-white">
        <p className="text-sm uppercase tracking-wide text-white/80">Flywork</p>
        <h1 className="mt-3 text-4xl font-bold">İç operasyon paneli</h1>
        <p className="mt-4 max-w-md text-white/80">
          Yemek, izin ve gider işlemleri şirket hesabınızla açılır.
        </p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <h2 className="mb-6 text-2xl font-bold">Giriş</h2>
          <LoginForm nextPath={params.next} />
          {adminCount === 0 ? (
            <p className="mt-6 text-sm text-gray-600">
              Henüz yönetici hesabı yok. İlk yönetici, sunucuda{" "}
              <span className="font-mono">npm run admin:create</span> komutuyla
              oluşturulur. Komut ad, e-posta ve şifreyi ortam değişkeninden okur.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default function LoginPage({
  searchParams,
}

) {
  return (
    <Suspense fallback={<div className="p-8 text-gray-600">Giriş ekranı hazırlanıyor…</div>}>
      <LoginScreen searchParams={searchParams} />
    </Suspense>
  );
}
