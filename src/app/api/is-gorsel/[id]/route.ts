import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openWorkImage } from "@/server/services/work";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await readCurrentUser();
  if (!actor) {
    return NextResponse.json({ message: "Oturum bulunamadı." }, { status: 401 });
  }
  try {
    const { id } = await params;
    const image = await openWorkImage(actor, id);
    return new NextResponse(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        "content-type": image.contentType,
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
