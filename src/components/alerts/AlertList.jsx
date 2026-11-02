"use client";

import { useMemo, useState } from "react";
import { Bell, CalendarDays, Cpu, FileText, RefreshCw, Workflow } from "lucide-react";
import { dismissAlertAction, dismissVisibleAlertsAction, markAlertReadAction, markAllAlertsReadAction } from "@/app/(panel)/bildirimler/actions";
import EmptyState from "@/components/ui/EmptyState";
import NotificationItem from "@/components/ui/NotificationItem";









const TABS = [
  { id: "action", label: "Aksiyon gerekli" },
  { id: "info", label: "Bilgi" },
];

function category(alert) {
  return alert.category || "Diğer";
}

function iconFor(name) {
  if (name === "Fatura") return <FileText size={18} />;
  if (name === "İzin") return <CalendarDays size={18} />;
  if (name === "Yenileme") return <RefreshCw size={18} />;
  if (name === "Otomasyon") return <Workflow size={18} />;
  if (name === "Taslak") return <Cpu size={18} />;
  return <Bell size={18} />;
}

export default function AlertList({ alerts }) {
  const [level, setLevel] = useState("action");
  const [gone, setGone] = useState([]);
  const [readIds, setReadIds] = useState([]);
  const [clearedLevel, setClearedLevel] = useState("");
  const visible = useMemo(
    () => alerts
      .filter((alert) => alert.level === level && !gone.includes(alert.key) && clearedLevel !== level)
      .map((alert) => (readIds.includes(alert.key) ? { ...alert, read: true } : alert)),
    [alerts, level, gone, readIds, clearedLevel],
  );
  const unread = visible.filter((alert) => !alert.read).length;

  function hide(key) {
    setGone((current) => (current.includes(key) ? current : [...current, key]));
  }

  function markRead(key) {
    setReadIds((current) => (current.includes(key) ? current : [...current, key]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setLevel(item.id)}
            className={item.id === level ? "btn-primary shrink-0 rounded-full" : "btn-secondary shrink-0 rounded-full"}
          >
            {item.label}
          </button>
        ))}
        {unread > 0 ? (
          <form onSubmit={(event) => {
            event.preventDefault();
            setReadIds((current) => [...new Set([...current, ...visible.map((alert) => alert.key)])]);
            const data = new FormData();
            data.set("level", level);
            void markAllAlertsReadAction(data);
          }}>
            <button className="btn-secondary">Bu sekmedekileri okundu işaretle</button>
          </form>
        ) : null}
        {visible.length > 0 ? (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!window.confirm("Bu sekmedeki bildirimler silinsin mi?")) return;
            setClearedLevel(level);
            const data = new FormData();
            data.set("level", level);
            void dismissVisibleAlertsAction(data);
          }}>
            <button className="btn-secondary">Bu sekmedekileri sil</button>
          </form>
        ) : null}
      </div>
      {visible.length === 0 ? <EmptyState title={level === "action" ? "Aksiyon gereken bildirim yok." : "Bilgi bildirimi yok."} icon={<Bell size={28} />} /> : (
        <div className="panel-card">
          {visible.map((alert) => (
            <NotificationItem
              key={alert.key}
              title={alert.title}
              body={alert.body}
              href={alert.href}
              read={alert.read}
              category={category(alert)}
              icon={iconFor(category(alert))}
              action={(
                <>
                  {alert.read ? null : (
                    <button type="button" className="font-semibold text-slate-700" onClick={() => { markRead(alert.key); const data = new FormData(); data.set("key", alert.key); void markAlertReadAction(data); }}>Okundu</button>
                  )}
                  <button type="button" className="font-semibold text-red-600" onClick={() => { hide(alert.key); const data = new FormData(); data.set("key", alert.key); void dismissAlertAction(data); }}>Sil</button>
                </>
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
