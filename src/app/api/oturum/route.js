import { NextResponse } from "next/server";
import { loginWithPassword, logout, readCurrentUser } from "@/server/auth/session";
import { AppError, toPublicError } from "@/server/errors";

function errorResponse(error) {
  const pub = toPublicError(error);
  return NextResponse.json(
    { message: pub.message, code: pub.code },
    { status: pub.status },
  );
}

export async function GET() {
  try {
    const user = await readCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Oturum bulunamadı.", code: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => {
      throw new AppError("Gönderilen bilgiler geçersiz.", "VALIDATION", 400);
    });
    const user = await loginWithPassword(body);
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    await logout();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
