import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openChatAttachment } from "@/server/services/chat";

export async function GET(_request, { params }) {
  const actor = await readCurrentUser();
  if (!actor) return NextResponse.json({ message: "Oturum bulunamadı." }, { status: 401 });
  try {
    const { id } = await params;
    const file = await openChatAttachment(actor, id);
    const download = !String(file.contentType).startsWith("image/");
    const disposition = download
      ? `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
      : "inline";
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": disposition,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message }, { status: pub.status });
  }
}
