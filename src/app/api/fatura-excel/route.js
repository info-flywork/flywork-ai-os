import { NextResponse } from "next/server";
import { readCurrentUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { buildInvoiceWorkbook } from "@/server/finance/invoiceWorkbook";
import { getInvoicePage } from "@/server/services/finance";

export async function GET(request) {
  const actor = await readCurrentUser();
  if (!actor) {
    return NextResponse.json(
      { message: "Oturum bulunamadı.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const month = url.searchParams.get("ay") ?? "";
  const scope = url.searchParams.get("alan") === "ofis" ? "OFFICE" : "COMPANY";
  try {
    const page = await getInvoicePage(actor, month, scope);
    const bytes = await buildInvoiceWorkbook(page.invoices, url.origin);
    const name = scope === "OFFICE" ? "ofis-faturalar" : "flywork-faturalar";
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}-${page.month}.xlsx"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const pub = toPublicError(error);
    return NextResponse.json({ message: pub.message, code: pub.code }, { status: pub.status });
  }
}
