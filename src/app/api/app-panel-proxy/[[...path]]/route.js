import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { prefixPanelLocation, prefixPanelPaths } from "@/lib/appPanelPaths";
import { getServiceToken, isAppPanelHost, rewriteTokenCookie, upstreamLocation, upstreamUrl } from "@/server/products/appPanelProxy";

export const instant = false;

const HOP = new Set(["connection", "content-length", "host", "keep-alive", "transfer-encoding"]);

function textual(contentType) {
  return /text\/|javascript|json|xml|css/i.test(contentType ?? "");
}

async function forward(request, context) {
  const host = request.headers.get("host");
  const sameOrigin = !isAppPanelHost(host);
  if (sameOrigin && !(await cookies()).has("flywork_session")) {
    return NextResponse.json({ message: "Sayfa bulunamadı." }, { status: 404 });
  }

  const { path: segments = [] } = await context.params;
  const incoming = new URL(request.url);
  incoming.searchParams.delete("kopru");
  const search = incoming.searchParams.size ? `?${incoming.searchParams.toString()}` : "";
  const browserToken = (await cookies()).get("token")?.value ?? "";

  let path = segments.join("/") === "login.html" ? ["panel"] : segments;
  let token = "";
  try {
    token = await getServiceToken();
  } catch {
    token = browserToken;
  }

  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const requestBody = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  async function pull(sessionToken) {
    const headers = new Headers();
    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    if (sessionToken) headers.set("cookie", `token=${sessionToken}`);
    return fetch(upstreamUrl(path, search), {
      method: request.method,
      headers,
      body: requestBody,
      redirect: "manual",
      cache: "no-store",
    });
  }

  let upstream;
  try {
    upstream = await pull(token);
    const location = upstreamLocation(upstream.headers.get("location")) ?? "";
    if (location.startsWith("/login") || upstream.status === 401) {
      const fresh = await getServiceToken(true);
      if (fresh) {
        token = fresh;
        upstream = await pull(fresh);
      }
    }
  } catch {
    return NextResponse.json({ message: "App Panel şu an açılmadı." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP.has(name) || name === "set-cookie" || name === "content-encoding" || name === "content-length") return;
    responseHeaders.set(key, value);
  });
  const location = upstreamLocation(upstream.headers.get("location"));
  if (location) responseHeaders.set("location", sameOrigin ? prefixPanelLocation(location) : location);
  if (sameOrigin) {
    responseHeaders.delete("x-frame-options");
    responseHeaders.delete("content-security-policy");
  }
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    const rewritten = rewriteTokenCookie(cookie);
    if (rewritten) responseHeaders.append("set-cookie", rewritten);
  }
  if (token && token !== browserToken) {
    const sessionCookie = rewriteTokenCookie(`token=${token}; Max-Age=86400; Path=/; HttpOnly`);
    if (sessionCookie) responseHeaders.append("set-cookie", sessionCookie);
  }
  responseHeaders.set("cache-control", "private, no-store");
  responseHeaders.set("x-flywork-app-panel", "1");

  let body = request.method === "HEAD" ? null : upstream.body;
  if (body && sameOrigin && textual(upstream.headers.get("content-type"))) {
    body = prefixPanelPaths(await upstream.text());
  }

  return new NextResponse(body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export function GET(request, context) {
  return forward(request, context);
}

export function POST(request, context) {
  return forward(request, context);
}

export function PUT(request, context) {
  return forward(request, context);
}

export function PATCH(request, context) {
  return forward(request, context);
}

export function DELETE(request, context) {
  return forward(request, context);
}

export function HEAD(request, context) {
  return forward(request, context);
}
