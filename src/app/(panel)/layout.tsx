import { Suspense, type ReactNode } from "react";
import PanelFrame from "@/components/PanelFrame";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { requireUser } from "@/server/auth/session";
import { unreadAlertCount } from "@/server/services/alerts";

export const instant = false;

async function PanelShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  let alertCount = 0;
  try {
    alertCount = await unreadAlertCount(user);
  } catch {
    alertCount = 0;
  }

  return (
    <PanelFrame user={{ name: user.name, role: user.role, mealOnly: user.mealOnly }} alertCount={alertCount}>
      {children}
    </PanelFrame>
  );
}

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <PanelShell>{children}</PanelShell>
    </Suspense>
  );
}
