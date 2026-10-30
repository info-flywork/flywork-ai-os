

import Link from "next/link";

const TABS = [
  ["flywork", "Flywork Faturaları", "/harcama"],
  ["ofis", "Ofis Harcamaları", "/harcama?sekme=ofis"],
] ;

export default function FinanceDesk({
  active,
  children,
}


) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Harcamalar ve Faturalar</h1>
      </header>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label, href]) => (
          <Link key={id} href={href} className={id === active ? "btn-primary" : "btn-secondary"}>
            {label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
