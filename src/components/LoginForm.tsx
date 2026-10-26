"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import FormField from "@/components/ui/FormField";
import { landingPath } from "@/lib/safeNextPath";

export default function LoginForm({ nextPath }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const response = await fetch("/api/oturum", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      user?: { role?: string; mealOnly?: boolean };
    } | null;

    if (!response.ok) {
      setMessage(body?.message ?? "Giriş yapılamadı.");
      setPending(false);
      return;
    }

    router.refresh();
    router.push(landingPath(body?.user?.role ? { role: body.user.role, mealOnly: body.user.mealOnly } : null, nextPath));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {message ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {message}
        </p>
      ) : null}
      <FormField label="E-posta" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="field"
        />
      </FormField>
      <FormField label="Şifre" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="field"
        />
      </FormField>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full"
      >
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}
