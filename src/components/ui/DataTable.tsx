import type { ReactNode } from "react";

export default function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="panel-card overflow-x-auto">
      <table className="data-table">{children}</table>
    </div>
  );
}
