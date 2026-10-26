import type { Instrumentation } from "next";
import { assertProductionEnv } from "@/server/runtime/productionEnv";
import { redact } from "@/server/runtime/redact";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  assertProductionEnv();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const message = error instanceof Error ? error.message : "İstek tamamlanamadı.";
  const digest = typeof error === "object" && error && "digest" in error ? String(error.digest) : "";
  console.error(
    `İstek hatası ${request.method} ${context.routePath} ${redact(message).slice(0, 300)}${digest ? ` ${digest}` : ""}`,
  );
};
