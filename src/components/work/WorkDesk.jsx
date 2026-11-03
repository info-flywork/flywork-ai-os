import Link from "next/link";

const TABS = [
  ["kartlar", "Kartlar", "/is-takibi"],
  ["calisma", "Çalışma", "/is-takibi?sekme=calisma"],
];

export default function WorkDesk({ active, children }) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">İş Takibi</h1>
        <div className="flex flex-wrap gap-2">
          {TABS.map(([id, label, href]) => (
            <Link key={id} href={href} className={id === active ? "btn-primary" : "btn-secondary"}>
              {label}
            </Link>
          ))}
        </div>
      </header>
      {children}
    </div>
  );
}
