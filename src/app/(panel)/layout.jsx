import { Suspense } from "react";
import PanelFrame from "@/components/PanelFrame";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { requireUser } from "@/server/auth/session";
import { unreadAlertCount } from "@/server/services/alerts";

export const instant = false;

async function AlertPill({ user }) {
  let count = 0;
  try {
    count = await unreadAlertCount(user);
  } catch {
    count = 0;
  }
  if (!count) {
    return null;
  }
  return (
    <span className="min-w-5 rounded-full bg-[#ff5a5f] px-1.5 py-0.5 text-center text-[11px] font-semibold text-white">
      {count}
    </span>
  );
}

async function AlertDot({ user }) {
  let count = 0;
  try {
    count = await unreadAlertCount(user);
  } catch {
    count = 0;
  }
  if (!count) {
    return null;
  }
  return <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#ff5a5f]" />;
}

async function PanelShell({ children }) {
  const user = await requireUser();
  const alerts = user.role === "ADMIN";

  return (
    <PanelFrame
      user={{ name: user.name, role: user.role, mealOnly: user.mealOnly }}
      alertBadge={alerts ? <Suspense fallback={null}><AlertPill user={user} /></Suspense> : null}
      alertDot={alerts ? <Suspense fallback={null}><AlertDot user={user} /></Suspense> : null}
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
