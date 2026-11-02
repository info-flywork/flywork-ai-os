import { Suspense } from "react";
import PanelFrame from "@/components/PanelFrame";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { requireUser } from "@/server/auth/session";
import { countChatUnread } from "@/server/services/chat";

export const instant = false;

async function ChatBadge({ user }) {
  const count = await countChatUnread(user).catch(() => 0);
  if (!count) return null;
  return (
    <span className="min-w-5 rounded-full bg-[#03624c] px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white">
      {count}
    </span>
  );
}

async function PanelShell({ children }) {
  const user = await requireUser();

  return (
    <PanelFrame
      user={{ name: user.name, role: user.role, mealOnly: user.mealOnly }}
      chatBadge={user.mealOnly ? null : (
        <Suspense fallback={null}>
          <ChatBadge user={user} />
        </Suspense>
      )}
    >
      {children}
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
