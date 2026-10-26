import { NextResponse } from "next/server";


export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (pathname === "/giris") {
    return NextResponse.next();
  }

  if (!request.cookies.has("flywork_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/giris";
    if (pathname !== "/") {
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  const mealOnly = request.cookies.get("flywork_meal")?.value === "1";
  const staff = request.cookies.get("flywork_staff")?.value === "1";
  const mealPage = pathname === "/yemek-yonetimi" || pathname.startsWith("/yemek-yonetimi/");
  const leavePage = pathname === "/izin" || pathname.startsWith("/izin/");
  const taskPage = pathname === "/is-takibi" || pathname.startsWith("/is-takibi/");
  const feedbackPage = pathname === "/oneri" || pathname.startsWith("/oneri/");
  if ((mealOnly && !mealPage) || (staff && !mealPage && !leavePage && !taskPage && !feedbackPage)) {
    const url = request.nextUrl.clone();
    url.pathname = "/yemek-yonetimi";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
