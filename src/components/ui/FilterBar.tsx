import type { ReactNode } from "react";

export default function FilterBar({ children }: { children: ReactNode }) {
  return <div className="panel-card grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
