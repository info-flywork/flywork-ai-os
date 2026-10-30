import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { openProductFile } from "@/server/products/files";

export async function GET(_request, { params }) {
  const actor = await readCurrentUser();
  if (!actor) {
    return NextResponse.json({ message: "Oturum bulunamadı." }, { status: 401 });
  }

  try {
    assertNotMealOnly(actor);
    const { path: segments } = await params;
    const file = await openProductFile(segments);
    const encoded = encodeURIComponent(file.fileName);
    const disposition = file.inline ? "inline" : `attachment; filename*=UTF-8''${encoded}`;
    const body = file.stream ? Readable.toWeb(file.stream) : new Uint8Array(file.bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": disposition,
        "content-length": String(file.size ?? file.bytes.length),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message }, { status: pub.status });
  }
}
