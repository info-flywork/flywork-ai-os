"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";

function NavProgress() {
  const pathname = usePathname();
  const [pendingPath, setPendingPath] = useState("");

  useEffect(() => {
    setPendingPath("");
  }, [pathname]);

  useEffect(() => {
    function onClick(event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setPendingPath(url.pathname);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!pendingPath) return null;
  return <div className="fixed inset-x-0 top-0 z-50 h-1 animate-pulse bg-[#03624c]" />;
}

export default function PanelFrame({
  user,
  chatBadge = null,
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
      <NavProgress />
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
        chatBadge={chatBadge}
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
