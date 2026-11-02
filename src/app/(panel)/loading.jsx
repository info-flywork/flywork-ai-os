"use client";

import { usePathname } from "next/navigation";
import { panelNav, profileNav } from "@/components/panelNav";

export default function PanelLoading() {
  const pathname = usePathname();
  const match = [...panelNav, ...profileNav].find((item) => (
    item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`)
  ));

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      {match ? <h1 className="page-title">{match.name}</h1> : <div className="h-8 w-48 animate-pulse rounded-xl bg-slate-200" />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl bg-white" />
        ))}
      </div>
    </div>
  );
}
