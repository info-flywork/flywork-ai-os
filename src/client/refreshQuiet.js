"use client";

import { startTransition, useState } from "react";
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

export function useQuietAction(action, initial = null) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  function submit(eventOrData) {
    let data = eventOrData;
    if (typeof eventOrData?.preventDefault === "function") {
      eventOrData.preventDefault();
      const form = eventOrData.currentTarget;
      data = new FormData(form);
      const submitter = eventOrData.nativeEvent?.submitter;
      if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
    }
    void Promise.resolve(action(state, data)).then((next) => {
      setState(next ?? null);
      if (next && typeof next === "object" && next.ok === false) return;
      refreshQuiet(router);
    });
  }
  return [state, submit, false];
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
