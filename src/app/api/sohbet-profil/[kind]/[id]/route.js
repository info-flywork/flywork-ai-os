import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openChatProfilePhoto } from "@/server/services/chat";

export async function GET(_request, { params }) {
  const actor = await readCurrentUser();
  if (!actor) return NextResponse.json({ message: "Oturum bulunamadı." }, { status: 401 });
  try {
    const { kind, id } = await params;
    if (kind !== "kisi" && kind !== "grup") {
      return NextResponse.json({ message: "Fotoğraf bulunamadı." }, { status: 404 });
    }
    const photo = await openChatProfilePhoto(actor, kind, id);
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
    return NextResponse.json({ message: pub.message }, { status: pub.status });
  }
}
