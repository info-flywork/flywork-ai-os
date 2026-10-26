import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openReviewPdf } from "@/server/services/invoiceReview";

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
    const document = await openReviewPdf(actor, id);
    const encoded = encodeURIComponent(document.fileName);
    return new NextResponse(new Uint8Array(document.bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename*=UTF-8''${encoded}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message, code: pub.code }, { status: pub.status });
  }
}
