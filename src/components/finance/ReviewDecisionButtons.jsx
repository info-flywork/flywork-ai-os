"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";



export function ReviewDecisionButtons({
  amountBlocked,
  retry,
}


) {
  const { pending } = useFormStatus();
  const [choice, setChoice] = useState(null);
  const guard = useRef(false);
  const busy = pending || choice !== null;

  function take(next, event) {
    if (guard.current || ((next === "approve" || next === "retry") && amountBlocked)) {
      event.preventDefault();
      return;
    }
    guard.current = true;
    setChoice(next);
  }

  return (
    <div className="flex flex-wrap gap-3 md:col-span-2">
      <button
        type="submit"
        name="decision"
        value="approve"
        disabled={busy || amountBlocked}
        onClick={(event) => take("approve", event)}
        className="btn-primary disabled:opacity-40"
      >
        {choice === "approve" ? "Onaylanıyor…" : "Onayla"}
      </button>
      {retry ? (
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={busy || amountBlocked}
          onClick={(event) => take("retry", event)}
          className="btn-secondary disabled:opacity-40"
        >
          {choice === "retry" ? "Yükleniyor…" : "Drive yüklemesini yeniden dene"}
        </button>
      ) : (
        <>
          <button
            type="submit"
            name="decision"
            value="hold"
            disabled={busy}
            onClick={(event) => take("hold", event)}
            className="btn-secondary disabled:opacity-40"
          >
            {choice === "hold" ? "Kaydediliyor…" : "Beklet"}
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            disabled={busy}
            onClick={(event) => take("reject", event)}
            className="btn-secondary disabled:opacity-40"
          >
            {choice === "reject" ? "Kaydediliyor…" : "Reddet"}
          </button>
        </>
      )}
    </div>
  );
}
