import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openLeaveDocument } from "@/server/services/leave";

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
    const document = await openLeaveDocument(actor, id);
    const encoded = encodeURIComponent(document.fileName);
    return new NextResponse(new Uint8Array(document.bytes), {
      status: 200,
      headers: {
        "content-type": document.contentType,
        "content-disposition": `attachment; filename*=UTF-8''${encoded}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message, code: pub.code }, { status: pub.status });
  }
}
