import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openMealPhoto } from "@/server/services/meals";

export async function GET(
  _request,
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
    const photo = await openMealPhoto(actor, id);
    return new NextResponse(new Uint8Array(photo.bytes), {
      status: 200,
      headers: {
        "content-type": photo.contentType,
        "content-disposition": "inline",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message, code: pub.code }, { status: pub.status });
  }
}
