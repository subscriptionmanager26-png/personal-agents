import { NextResponse, type NextRequest } from "next/server";

import { isAdminHost } from "@/lib/site-mode";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (!isAdminHost(host)) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/join") || pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? "/app" : "/app";
    if (pathname.startsWith("/join")) url.pathname = "/app";
    return NextResponse.redirect(url);
  }
  if (pathname === "/signup" || (pathname === "/" && request.nextUrl.searchParams.get("mode") === "signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("mode", "login");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/join/:path*", "/signup"],
};
