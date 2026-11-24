import { NextResponse, type NextRequest } from "next/server";
import { loadAuthConfig } from "./features/identity/config.server";
import { cookieOptions, createAuthClient } from "./features/identity/supabase.server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  const config = loadAuthConfig();
  if (config) {
    try {
      await createAuthClient(config, {
        getAll: () => request.cookies.getAll(),
        setAll: (values, headers) => {
          for (const { name, value } of values) request.cookies.set(name, value);
          const previous = response.cookies.getAll();
          response = NextResponse.next({ request });
          for (const cookie of previous) response.cookies.set(cookie);
          for (const { name, value, options } of values) response.cookies.set(name, value, { ...options, ...cookieOptions(config) });
          response.headers.set("Cache-Control", "private, no-store, max-age=0");
          for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        },
      }).auth.getUser();
    }
    catch { /* Page-level verification independently fails closed. */ }
  }
  return response;
}
export const config = { matcher: ["/sign-in", "/account/:path*"] };
