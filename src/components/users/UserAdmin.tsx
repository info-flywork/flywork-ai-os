"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/Notice";
import StatusBadge from "@/components/ui/StatusBadge";
import {
  createAccountAction,
  deleteAccountAction,
  setActiveAction,
  updateAccountAction,
  type ActionState,
} from "@/app/(panel)/kullanicilar/actions";

type Account = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE";
  mealOnly: boolean;
  approver: boolean;
  active: boolean;
  startedOn: string | null;
};

function startLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function roleLabel(role: Account["role"]) {
  return role === "ADMIN" ? "Yönetici" : "Çalışan";
}

function EditForm({ user, current }: { user: Account; current: boolean }) {
  const [state, action, pending] = useActionState<ActionState | undefined, FormData>(
    updateAccountAction,
    undefined,
  );
  const [role, setRole] = useState(user.role);
  const [mealOnly, setMealOnly] = useState(user.mealOnly);
  const needsStart = role === "EMPLOYEE" && !mealOnly;
  const [removeState, removeAction, removePending] = useActionState<ActionState | undefined, FormData>(
    deleteAccountAction,
    undefined,
  );
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="userId" value={user.id} />
        {state ? (
          <div className="sm:col-span-2">
            <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice>
          </div>
        ) : null}
        <label className="text-sm">
          Ad
          <input name="name" required minLength={2} defaultValue={user.name} className="field mt-1" />
        </label>
        <label className="text-sm">
          E-posta
          <input name="email" type="email" required defaultValue={user.email} className="field mt-1" />
        </label>
        <label className="text-sm">
          Rol
          <select name="role" value={role} className="field mt-1" onChange={(event) => setRole(event.target.value as Account["role"])}>
            <option value="EMPLOYEE">Çalışan</option>
            <option value="ADMIN">Yönetici</option>
          </select>
        </label>
        <label className="text-sm">
          İşe başlama tarihi
          <input type="date" name="startedOn" required={needsStart} defaultValue={user.startedOn ?? ""} className="field mt-1" />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="mealOnly" checked={mealOnly} onChange={(event) => setMealOnly(event.target.checked)} />
          Yalnızca yemek siparişi
        </label>
        <label className="text-sm">
          Yeni şifre
          <input name="password" type="password" autoComplete="new-password" placeholder="Boş bırakılırsa değişmez" className="field mt-1" />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </form>
      {current ? null : (
        <form
          action={removeAction}
          className="mt-3"
          onSubmit={(event) => {
            if (!window.confirm(`${user.name} hesabı silinsin mi?`)) event.preventDefault();
          }}
        >
          <input type="hidden" name="userId" value={user.id} />
          {removeState ? <Notice tone={removeState.ok ? "ok" : "err"}>{removeState.message}</Notice> : null}
          <button
            type="submit"
            disabled={removePending}
            className="inline-flex min-h-10 items-center rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600"
          >
            {removePending ? "Siliniyor…" : "Sil"}
          </button>
        </form>
      )}
    </div>
  );
}

function ActiveForm({ user }: { user: Account }) {
  const [state, action, pending] = useActionState<ActionState | undefined, FormData>(
    setActiveAction,
    undefined,
  );

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="active" value={user.active ? "false" : "true"} />
      <button type="submit" disabled={pending} className="btn-secondary">
        {pending ? "Kaydediliyor…" : user.active ? "Kapat" : "Aç"}
      </button>
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
    </form>
  );
}

export default function UserAdmin({
  currentUserId,
  users,
  canManage = true,
}: {
  currentUserId: string;
  users: Account[];
  canManage?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState | undefined, FormData>(
    createAccountAction,
    undefined,
  );
  const [role, setRole] = useState<"ADMIN" | "EMPLOYEE">("EMPLOYEE");
  const [mealOnly, setMealOnly] = useState(false);
  const needsStart = role === "EMPLOYEE" && !mealOnly;
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Kullanıcılar</h1>
        <p className="page-lead">Ad, e-posta, rol ve işe başlama tarihi listeden güncellenir. Herkes kendi şifresini hesap menüsünden değiştirir. Buradan da yeni şifre yazılabilir.</p>
      </header>

      {canManage ? <section className="panel-card">
        <h2 className="section-title">Yeni hesap</h2>
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          {state ? (
            <div className="sm:col-span-2">
              <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm" htmlFor="account-name">Ad</label>
            <input id="account-name" name="name" required className="field" />
          </div>
          <div>
            <label className="mb-1 block text-sm" htmlFor="account-email">E-posta</label>
            <input id="account-email" name="email" type="email" required className="field" />
          </div>
          <div>
            <label className="mb-1 block text-sm" htmlFor="account-password">Şifre</label>
            <input
              id="account-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="field"
            />
            <p className="mt-1 text-xs text-gray-600">En az 8 karakter, harf, rakam ve özel karakter.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm" htmlFor="account-role">Rol</label>
            <select id="account-role" name="role" value={role} className="field" onChange={(event) => setRole(event.target.value as "ADMIN" | "EMPLOYEE")}>
              <option value="EMPLOYEE">Çalışan</option>
              <option value="ADMIN">Yönetici</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm" htmlFor="account-started">İşe başlama tarihi</label>
            <input id="account-started" name="startedOn" type="date" required={needsStart} className="field" />
            <p className="mt-1 text-xs text-gray-600">İzin kartı bu tarihe göre açılır.</p>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="mealOnly" checked={mealOnly} onChange={(event) => setMealOnly(event.target.checked)} />
            Yalnızca yemek siparişi
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto">
              {pending ? "Kaydediliyor…" : "Hesabı oluştur"}
            </button>
          </div>
        </form>
      </section> : null}

      <section className="panel-card">
        <h2 className="section-title">Hesaplar</h2>
        <ul>
          {users.map((user) => {
            const open = openId === user.id;
            const current = user.id === currentUserId;
            return (
              <li key={user.id} className="border-b border-slate-100 py-4 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#03624c] text-sm font-semibold text-white">
                      {user.name.trim().charAt(0).toLocaleUpperCase("tr")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {user.name}
                        {current ? <span className="ml-2 text-xs font-medium text-slate-400">Bu hesap</span> : null}
                      </p>
                      <p className="truncate text-sm text-slate-500">{user.email}</p>
                      {user.startedOn ? (
                        <p className="truncate text-sm text-slate-500">İşe başlama: {startLabel(user.startedOn)}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={user.role === "ADMIN" ? "info" : "neutral"}>{roleLabel(user.role)}</StatusBadge>
                    {user.mealOnly ? <StatusBadge tone="neutral">Yalnızca yemek</StatusBadge> : null}
                    {user.role === "ADMIN" && !user.approver ? <StatusBadge tone="neutral">Görüntüleme</StatusBadge> : null}
                    <StatusBadge tone={user.active ? "ok" : "bad"}>{user.active ? "Açık" : "Kapalı"}</StatusBadge>
                    {canManage ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : user.id)}
                      >
                        {open ? "Vazgeç" : "Düzenle"}
                      </button>
                    ) : null}
                    {canManage && !current ? <ActiveForm user={user} /> : null}
                  </div>
                </div>
                {open ? <EditForm user={user} current={current} /> : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
