import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertCan } from "@/server/auth/permissions";
import { readCurrentUser } from "@/server/auth/session";
import { finishGoogleConnect } from "@/server/services/googleLink";
import { oauthStatesMatch } from "@/server/google/oauth";

const STATE_COOKIE = "flywork_google_oauth";

function panelRedirect(request: Request, code: string) {
  const response = NextResponse.redirect(new URL(`/otomasyon?google=${code}`, request.url));
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google/oauth",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const user = await readCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/giris?next=/otomasyon", request.url));
  }
  try {
    assertCan(user, "automation:write");
  } catch {
    return panelRedirect(request, "yetki");
  }

  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(STATE_COOKIE)?.value;
  if (oauthError) {
    return panelRedirect(request, "red");
  }
  if (!code || !state || !expected || !oauthStatesMatch(expected, state)) {
    return panelRedirect(request, "durum");
  }
  try {
    await finishGoogleConnect(user, code);
    return panelRedirect(request, "baglandi");
  } catch {
    return panelRedirect(request, "hata");
  }
}
