import { Suspense } from "react";
import PanelFrame from "@/components/PanelFrame";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { requireUser } from "@/server/auth/session";

export const instant = false;

async function PanelShell({ children }) {
  const user = await requireUser();

  return (
    <PanelFrame
      user={{ name: user.name, role: user.role, mealOnly: user.mealOnly }}
    >
      <Suspense fallback={<LoadingSkeleton />}>{children}</Suspense>
    </PanelFrame>
  );
}

export default function PanelLayout({ children }) {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <PanelShell>{children}</PanelShell>
    </Suspense>
  );
}
