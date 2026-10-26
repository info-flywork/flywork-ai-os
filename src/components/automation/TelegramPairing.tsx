"use client";

import { useActionState } from "react";
import { createTelegramPairingAction, revokeTelegramLinkAction } from "@/app/(panel)/otomasyon/actions";

export default function TelegramPairing({ linked, lead, showCode = true }: { linked: boolean; lead?: string; showCode?: boolean }) {
  const [state, action, pending] = useActionState(createTelegramPairingAction, null);

  return (
    <div className="mt-3 space-y-2">
      <p>{lead ?? (linked ? "Yönetici Telegram hesabı bağlı." : "Yönetici Telegram hesabı bağlı değil.")}</p>
      {lead ? <p>{linked ? "Telegram bağlı." : "Telegram bağlı değil."}</p> : null}
      {showCode ? (
        <form action={action}>
          <button className="btn-primary" disabled={pending}>Eşleştirme kodu üret</button>
        </form>
      ) : null}
      {state?.code ? (
        <p>Tek kullanımlık kod: {state.code}. 10 dakika içinde bota özel sohbette /start {state.code} yazın.</p>
      ) : null}
      {state?.error ? <p>{state.error}</p> : null}
      {linked ? (
        <form action={revokeTelegramLinkAction}>
          <button className="btn-secondary">Telegram bağını kaldır</button>
        </form>
      ) : null}
    </div>
  );
}
