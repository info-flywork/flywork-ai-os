import { NextResponse } from "next/server";
import { assertCan } from "@/server/auth/permissions";
import { readCurrentUser } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { prepareGoogleConnect } from "@/server/services/googleLink";

const STATE_COOKIE = "flywork_google_oauth";

function panelRedirect(request, code) {
  return NextResponse.redirect(new URL(`/otomasyon?google=${code}`, request.url));
}

export async function GET(request) {
  const user = await readCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/giris?next=/otomasyon", request.url));
  }
  try {
    assertCan(user, "automation:write");
    const { url, state } = prepareGoogleConnect(user);
    const response = NextResponse.redirect(url);
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/google/oauth",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return panelRedirect(request, "yetki");
    }
    return panelRedirect(request, "ayar");
  }
}
