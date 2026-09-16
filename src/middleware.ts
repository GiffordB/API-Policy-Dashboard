import { NextRequest, NextResponse } from "next/server";

/**
 * Pilot access gate. One shared password, set as APP_PASSWORD.
 *
 * This is a door lock, not identity. It keeps the pilot off the open web while
 * the team tries the tool. It does NOT prove who made an edit — that is what
 * the "acting as" picker records, on trust. Replace both with your identity
 * provider before anyone treats the audit trail as evidence.
 */
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();            // unset locally = open
  if (req.nextUrl.pathname.startsWith("/login")) return NextResponse.next();
  if (req.cookies.get("pr_gate")?.value === password) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/collect).*)"],
};
