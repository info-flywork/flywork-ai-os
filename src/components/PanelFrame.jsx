"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";


export default function PanelFrame({
  user,
  children,
}



) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("flywork-sidebar") === "kapali");
  }, []);

  function setSidebar(next) {
    setCollapsed(next);
    window.localStorage.setItem("flywork-sidebar", next ? "kapali" : "acik");
  }

  return (
    <div className={`min-h-screen bg-[#f5f7fb] transition-[grid-template-columns] duration-200 lg:grid ${collapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]"}`}>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          aria-label="Menüyü kapat"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <AppSidebar
        user={user}
        open={open}
        collapsed={collapsed}
        onNavigate={() => setOpen(false)}
        onToggle={() => setSidebar(!collapsed)}
      />
      <div className="min-w-0">
        <button type="button" className="btn-secondary fixed left-3 top-3 z-20 lg:hidden" onClick={() => setOpen(true)} aria-label="Menü">
          <Menu size={18} />
        </button>
        <main className="px-4 py-4 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
