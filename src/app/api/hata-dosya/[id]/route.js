import { NextResponse } from "next/server";

import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openBugFile } from "@/server/products/bugs";

export async function GET(_request, { params }) {
  const actor = await readCurrentUser();
  if (!actor) {
    return NextResponse.json({ message: "Oturum bulunamadı." }, { status: 401 });
  }

  try {
    assertNotMealOnly(actor);
    const { id } = await params;
    const file = await openBugFile(id);
    const encoded = encodeURIComponent(file.fileName);
    const disposition = file.inline ? "inline" : `attachment; filename*=UTF-8''${encoded}`;
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": disposition,
        "content-length": String(file.bytes.length),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message }, { status: pub.status });
  }
}
