

const TABS = [
  ["ofis", "Ofis Harcamaları", "/harcama"],
  ["flywork", "Flywork Faturaları", "/harcama?sekme=flywork"],
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
          <a key={id} href={href} className={id === active ? "btn-primary" : "btn-secondary"}>
            {label}
          </a>
        ))}
      </div>
      {children}
    </div>
  );
}
