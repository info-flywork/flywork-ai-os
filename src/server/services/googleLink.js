import "server-only";
import { assertCan } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { connectFromAuthorizationCode, disconnectGoogle } from "@/server/google/account";
import { buildAuthorizationUrl, createOAuthState } from "@/server/google/oauth";

export function prepareGoogleConnect(actor) {
  assertCan(actor, "automation:write");
  const state = createOAuthState();
  return { url: buildAuthorizationUrl(state), state };
}

export async function finishGoogleConnect(actor, code) {
  assertCan(actor, "automation:write");
  return withDatabase((db) => connectFromAuthorizationCode(db, { code, connectedById: actor.id }));
}

export async function disconnectGoogleAccount(actor) {
  assertCan(actor, "automation:write");
  return withDatabase((db) => disconnectGoogle(db));
}
