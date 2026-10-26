import { timingSafeEqual } from "node:crypto";

export function webhookAuthorized(header: string | null, secret: string | null): boolean {
  if (!header || !secret) {
    return false;
  }
  const left = Buffer.from(header);
  const right = Buffer.from(secret);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
