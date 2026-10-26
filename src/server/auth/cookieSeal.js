import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { AppError } from "@/server/errors";

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError("Oturum anahtarı yapılandırılmamış.", "CONFIG", 500);
  }

  return Uint8Array.from(createHash("sha256").update(secret).digest());
}

export async function sealSessionToken(
  token,
  expiresAt,
) {
  return new EncryptJWT({ token })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .encrypt(encryptionKey());
}

export async function openSessionToken(sealed) {
  try {
    const { payload } = await jwtDecrypt(sealed, encryptionKey());
    return typeof payload.token === "string" ? payload.token : null;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    return null;
  }
}
