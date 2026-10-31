import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { LOCAL_API } from "./constants/local-api";
import { evaluateLocalApiMiddleware } from "./local-api-middleware";

export const middleware = (req: NextRequest): NextResponse => {
  const expected = process.env[LOCAL_API.TOKEN_ENV]?.trim() ?? "";
  const blocked = evaluateLocalApiMiddleware(req, expected);
  if (blocked) {
    return new NextResponse(blocked.body, {
      status: blocked.status,
      headers: blocked.headers,
    });
  }
  return NextResponse.next();
};

export const config = {
  matcher: "/api/:path*",
};
