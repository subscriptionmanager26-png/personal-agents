import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/request-origin";
import { clearSessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(`${requestOrigin(request)}/`, { status: 303 });
}

export async function GET(request: Request) {
  return POST(request);
}
