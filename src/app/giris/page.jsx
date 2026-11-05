import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { landingPath } from "@/lib/safeNextPath";
import { readCurrentUser } from "@/server/auth/session";
import { withDatabase } from "@/server/db";

export const instant = false;

function LoginShell({ nextPath = "", notice = null, hint = null }) {
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
          {notice}
          <LoginForm nextPath={nextPath} />
          {hint}
        </div>
      </section>
    </div>
  );
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function AdminHint() {
  let adminCount = null;
  try {
    adminCount = await withTimeout(
      withDatabase((db) => db.user.count({ where: { role: "ADMIN", active: true } })),
      2500,
    );
  } catch {
    adminCount = null;
  }
  if (adminCount !== 0) return null;
  return (
    <p className="mt-6 text-sm text-gray-600">
      Henüz yönetici hesabı yok. İlk yönetici, sunucuda{" "}
      <span className="font-mono">npm run admin:create</span> komutuyla
      oluşturulur. Komut ad, e-posta ve şifreyi ortam değişkeninden okur.
    </p>
  );
}

async function LoginScreen({ searchParams }) {
  const params = await searchParams;
  let user = null;
  let dbDown = false;
  try {
    user = await withTimeout(readCurrentUser(), 2500);
  } catch {
    dbDown = true;
    user = null;
  }
  if (user) {
    redirect(landingPath(user, params.next));
  }

  return (
    <LoginShell
      nextPath={params.next}
      notice={dbDown ? (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Veritabanına şu an ulaşılamıyor. Bağlantı gelince tekrar dene; giriş formu hazır.
        </p>
      ) : null}
      hint={(
        <Suspense fallback={null}>
          <AdminHint />
        </Suspense>
      )}
    />
  );
}

export default function LoginPage({ searchParams }) {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginScreen searchParams={searchParams} />
    </Suspense>
  );
}
