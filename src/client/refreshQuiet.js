"use client";

import { startTransition, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const timers = new WeakMap();

export function refreshQuiet(router) {
  const previous = timers.get(router);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    timers.delete(router);
    startTransition(() => {
      router.refresh();
    });
  }, 40);
  timers.set(router, timer);
}

function navigationError(error) {
  const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : "";
  return digest.startsWith("NEXT_");
}

export function useQuietAction(action, initial = null) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const running = useRef(0);
  function submit(eventOrData) {
    let data = eventOrData;
    if (typeof eventOrData?.preventDefault === "function") {
      eventOrData.preventDefault();
      const form = eventOrData.currentTarget;
      data = new FormData(form);
      const submitter = eventOrData.nativeEvent?.submitter;
      if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
    }
    running.current += 1;
    setPending(true);
    return Promise.resolve()
      .then(() => action(state, data))
      .then((next) => {
        setState(next ?? null);
        if (next && typeof next === "object" && next.ok === false) return next;
        refreshQuiet(router);
        return next;
      })
      .catch((error) => {
        if (navigationError(error)) throw error;
        setState({ ok: false, message: "İşlem tamamlanamadı. Yeniden deneyin." });
        return null;
      })
      .finally(() => {
        running.current = Math.max(0, running.current - 1);
        setPending(running.current > 0);
      });
  }
  return [state, submit, pending];
}

export function useQuietForm(action) {
  const router = useRouter();
  return (eventOrData) => {
    let data = eventOrData;
    if (typeof eventOrData?.preventDefault === "function") {
      eventOrData.preventDefault();
      data = new FormData(eventOrData.currentTarget);
      const submitter = eventOrData.nativeEvent?.submitter;
      if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
    }
    void Promise.resolve(action(data)).finally(() => refreshQuiet(router));
  };
}
