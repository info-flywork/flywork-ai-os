import "server-only";
import { io } from "next/cache";

const store = new Map();
const READ_TTL_MS = 60_000;

export async function remember(key, load, ttlMs = READ_TTL_MS) {
  try {
    await io();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("after()")) {
      throw error;
    }
  }
  const hit = store.get(key);
  if (hit?.value !== undefined && hit.until > Date.now()) {
    return hit.value;
  }
  if (hit?.pending) {
    return hit.pending;
  }
  const pending = load()
    .then((value) => {
      const current = store.get(key);
      if (current?.pending === pending) {
        store.set(key, { value, until: Date.now() + ttlMs });
      }
      return value;
    })
    .catch((error) => {
      const current = store.get(key);
      if (current?.pending === pending) {
        store.delete(key);
      }
      throw error;
    });
  store.set(key, { pending, until: 0 });
  if (store.size > 300) {
    const oldest = store.keys().next().value;
    if (oldest !== key) {
      store.delete(oldest);
    }
  }
  return pending;
}

export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      store.delete(key);
    }
  }
}
