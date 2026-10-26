import "server-only";
import { assertCan, type Actor } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { connectFromAuthorizationCode, disconnectGoogle } from "@/server/google/account";
import { buildAuthorizationUrl, createOAuthState } from "@/server/google/oauth";

export function prepareGoogleConnect(actor: Actor): { url: string; state: string } {
  assertCan(actor, "automation:write");
  const state = createOAuthState();
  return { url: buildAuthorizationUrl(state), state };
}

export async function finishGoogleConnect(actor: Actor, code: string): Promise<{ email: string }> {
  assertCan(actor, "automation:write");
  return withDatabase((db) => connectFromAuthorizationCode(db, { code, connectedById: actor.id }));
}

export async function disconnectGoogleAccount(actor: Actor): Promise<boolean> {
  assertCan(actor, "automation:write");
  return withDatabase((db) => disconnectGoogle(db));
}
