import { NextResponse } from "next/server";
import { withDatabase } from "@/server/db";

export async function GET() {
  try {
    await withDatabase((db) => db.$queryRaw`SELECT 1`);
    return NextResponse.json(
      { ok: true, database: "up" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, database: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
