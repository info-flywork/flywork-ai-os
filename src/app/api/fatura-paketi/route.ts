import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { buildInvoicePackage, buildMonthInvoiceZip } from "@/server/services/finance";

export async function GET(request: Request) {
  const actor = await readCurrentUser();
  if (!actor) {
    return NextResponse.json(
      { message: "Oturum bulunamadı.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const month = url.searchParams.get("ay") ?? "";
  const flywork = url.searchParams.get("alan") === "flywork";
  try {
    const pack = flywork
      ? await buildMonthInvoiceZip(actor, month, "COMPANY")
      : await buildInvoicePackage(actor, month);
    const filename = flywork ? `flywork-faturalar-${pack.month}.zip` : `faturalar-${pack.month}.zip`;
    return new NextResponse(new Uint8Array(pack.bytes), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message, code: pub.code }, { status: pub.status });
  }
}
