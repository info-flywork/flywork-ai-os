"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, PanelLeft, PanelLeftOpen } from "lucide-react";
import PasswordForm from "@/components/account/PasswordForm";
import { panelNav, profileNav } from "@/components/panelNav";


export default function AppSidebar({
  user,
  open = false,
  collapsed = false,
  onNavigate,
  onToggle,
}






) {
  const pathname = usePathname();
  const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);
  const role = user.role === "ADMIN" ? "Yönetici" : "Çalışan";
  const rail = collapsed ? "lg:hidden" : "";
  const initial = user.name.trim().charAt(0).toLocaleUpperCase("tr") || "F";

  async function logout() {
    setPending(true);
    setMessage(null);
    const response = await fetch("/api/oturum", { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) ;
      setMessage(body?.message ?? "Oturum kapatılamadı.");
      setPending(false);
      return;
    }
    router.refresh();
    router.push("/giris");
  }

  return (
    <aside
      className={`sidebar-shell fixed inset-y-0 left-0 z-40 flex h-screen w-[248px] flex-col text-slate-900 transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:z-20 lg:translate-x-0 lg:self-start ${open ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "lg:w-[72px]" : "lg:w-[248px]"}`}
    >
      <div className={`flex items-center gap-3 px-5 pb-4 pt-6 ${collapsed ? "lg:justify-center lg:px-2 lg:pt-4" : ""}`}>
        <img src="/flywork-mark.jpg" alt="" className={`h-10 w-10 shrink-0 rounded-xl object-cover ${rail}`} />
        <div className={`min-w-0 flex-1 ${rail}`}>
          <p className="text-[15px] font-semibold leading-tight">Flywork Panel</p>
        </div>
        <button
          type="button"
          className="hidden rounded-full p-2 text-slate-500 hover:bg-slate-100 lg:inline-flex"
          aria-label={collapsed ? "Menüyü aç" : "Menüyü kapat"}
          onClick={onToggle}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeft size={18} />}
        </button>
      </div>
      <nav className={`flex-1 space-y-1 overflow-y-auto px-3 ${collapsed ? "lg:px-2" : ""}`}>
        {panelNav
          .filter((item) => item.roles.includes(user.role) && (!user.mealOnly || item.path === "/yemek-yonetimi"))
          .map((item) => {
            const active = item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                href={item.path}
                title={item.name}
                aria-label={item.name}
                onClick={() => {
                  setAccountOpen(false);
                  setPasswordOpen(false);
                  onNavigate?.();
                }}
                className={`relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${collapsed ? "lg:justify-center lg:px-0" : ""} ${active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
              >
                <Icon size={18} aria-hidden="true" />
                <span className={`flex-1 ${rail}`}>{item.name}</span>
              </Link>
            );
          })}
      </nav>
      <div className={`relative m-3 ${collapsed ? "lg:mx-auto lg:mb-4 lg:w-11" : ""}`}>
        {accountOpen ? (
          <div className={`absolute bottom-full left-0 z-30 mb-2 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-lg ${collapsed ? `lg:bottom-0 lg:left-full lg:mb-0 lg:ml-2 ${passwordOpen ? "lg:w-72" : "lg:w-56"}` : ""}`}>
            {passwordOpen ? (
              <>
                <p className="text-sm font-semibold">{user.name}</p>
                <p className="text-xs text-slate-500">{role}</p>
                {message ? <p className="mt-2 text-sm text-red-700">{message}</p> : null}
                <PasswordForm />
              </>
            ) : (
              <>
                {profileNav
                  .filter((item) => item.roles.includes(user.role) && !user.mealOnly)
                  .map((item) => {
                    const active = pathname === item.path || pathname.startsWith(`${item.path}/`);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.path}
                        href={item.path}
                        onClick={() => {
                          setAccountOpen(false);
                          onNavigate?.();
                        }}
                        className={`mb-1 flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium ${active ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {item.name}
                      </Link>
                    );
                  })}
                <button type="button" className="btn-secondary mt-1 w-full" onClick={() => setPasswordOpen(true)}>
                  Şifre değiştir
                </button>
              </>
            )}
            <button type="button" className="btn-secondary mt-2 w-full" onClick={() => void logout()} disabled={pending}>
              {pending ? "Çıkış yapılıyor…" : "Oturumu kapat"}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={`flex w-full min-h-11 items-center gap-2 rounded-2xl px-1.5 py-1.5 hover:bg-slate-50 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
          aria-label="Hesap"
          aria-expanded={accountOpen}
          onClick={() => {
            setAccountOpen((value) => !value);
            setPasswordOpen(false);
          }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#03624c] text-sm font-semibold text-white">{initial}</span>
          <span className={`min-w-0 flex-1 text-left ${rail}`}>
            <span className="block truncate text-sm font-semibold text-slate-900">{user.name}</span>
            <span className="block text-xs text-slate-500">{role}</span>
          </span>
          <ChevronDown size={16} className={`shrink-0 text-slate-400 ${rail}`} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
