"use client";

import { useMemo, useState } from "react";
import { Bell, CalendarDays, Cpu, FileText, RefreshCw, Workflow } from "lucide-react";
import { markAlertReadAction } from "@/app/(panel)/bildirimler/actions";
import EmptyState from "@/components/ui/EmptyState";
import NotificationItem from "@/components/ui/NotificationItem";









const FILTERS = ["Tümü", "Okunmamış", "Fatura", "İzin", "Yenileme", "Otomasyon", "Taslak"] ;

function category(key) {
  if (key.startsWith("invoice.review:")) return "Fatura";
  if (key.startsWith("leave.request:")) return "İzin";
  if (key.startsWith("subscription.renewal:")) return "Yenileme";
  if (key.startsWith("automation.failed:")) return "Otomasyon";
  if (key.startsWith("technology.draft:")) return "Taslak";
  return "Diğer";
}

function iconFor(key) {
  const name = category(key);
  if (name === "Fatura") return <FileText size={18} />;
  if (name === "İzin") return <CalendarDays size={18} />;
  if (name === "Yenileme") return <RefreshCw size={18} />;
  if (name === "Otomasyon") return <Workflow size={18} />;
  if (name === "Taslak") return <Cpu size={18} />;
  return <Bell size={18} />;
}

export default function AlertList({ alerts }) {
  const [filter, setFilter] = useState("Tümü");
  const visible = useMemo(() => alerts.filter((alert) => {
    if (filter === "Tümü") return true;
    if (filter === "Okunmamış") return !alert.read;
    return category(alert.key) === filter;
  }), [alerts, filter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={item === filter ? "btn-primary shrink-0 rounded-full" : "btn-secondary shrink-0 rounded-full"}
          >
            {item}
          </button>
        ))}
      </div>
      {visible.length === 0 ? <EmptyState title="Bu filtrede bildirim yok." icon={<Bell size={28} />} /> : (
        <div className="panel-card">
          {visible.map((alert) => (
            <NotificationItem
              key={alert.key}
              title={alert.title}
              body={alert.body}
              href={alert.href}
              read={alert.read}
              category={category(alert.key)}
              icon={iconFor(alert.key)}
              action={alert.read ? null : (
                <form action={markAlertReadAction}>
                  <input type="hidden" name="key" value={alert.key} />
                  <button className="font-semibold text-slate-700">Okundu</button>
                </form>
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
