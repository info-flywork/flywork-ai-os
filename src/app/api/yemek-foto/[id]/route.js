import { io } from "next/cache";
import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openMealPhoto } from "@/server/services/meals";

const PHOTO_CACHE_MS = 10 * 60 * 1000;
const photoCache = new Map();

async function cachedMealPhoto(actor, id, version) {
  await io();
  const key = `${id}:${version}`;
  const hit = photoCache.get(key);
  if (hit && hit.until > Date.now()) {
    return hit.photo;
  }
  const photo = await openMealPhoto(actor, id);
  photoCache.set(key, { photo, until: Date.now() + PHOTO_CACHE_MS });
  if (photoCache.size > 200) {
    photoCache.delete(photoCache.keys().next().value);
  }
  return photo;
}

export async function GET(
  request,
  { params },
) {
  const actor = await readCurrentUser();
  if (!actor) {
    return NextResponse.json(
      { message: "Oturum bulunamadı.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  try {
    const { id } = await params;
    const version = new URL(request.url).searchParams.get("v") ?? "";
    const photo = await cachedMealPhoto(actor, id, version);
    return new NextResponse(new Uint8Array(photo.bytes), {
      status: 200,
      headers: {
        "content-type": photo.contentType,
        "content-disposition": "inline",
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message, code: pub.code }, { status: pub.status });
  }
}
