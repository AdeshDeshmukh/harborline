import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { loadAuthConfig, type AuthConfig } from "./config.server";
import { authCookieName, cookieOptions, createRouteAuthClient } from "./supabase.server";
import { verifySession } from "./session.server";
import type { AuthPort } from "./types";

type Dependencies = {
  config?: () => AuthConfig | null;
  client?: (request: NextRequest, response: NextResponse, config: AuthConfig) => AuthPort;
};
function response(location: string, status = 303) {
  return new NextResponse(null, { status, headers: {
    Location: location, "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Expires: "0", "Referrer-Policy": "no-referrer",
  } });
}
function returnPath(value: string | null) { return value === "/" ? "/" : "/account"; }
async function boundedForm(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  if (reader) {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 4096) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export function createAuthHandlers(deps: Dependencies = {}) {
  const settings = deps.config ?? loadAuthConfig;
  const createClient = deps.client ?? createRouteAuthClient;
  return {
    async start(request: NextRequest) {
      const config = settings();
      if (!config) return response("/sign-in?status=unavailable", 503);
      if (request.headers.get("origin") !== config.appOrigin) return response("/sign-in", 403);
      const form = await boundedForm(request).catch(() => null);
      if (!form) return response("/sign-in?status=invalid-email", 415);
      const email = form.get("email")?.trim() ?? "";
      if (form.getAll("email").length !== 1 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response("/sign-in?status=invalid-email");
      const result = response("/sign-in?status=check-email");
      try {
        const client = createClient(request, result, config);
        // Identical response for invited and unknown emails avoids enumeration.
        await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false,
          emailRedirectTo: `${config.appOrigin}/auth/callback?next=${encodeURIComponent(returnPath(form.get("next")))}` } });
      } catch { result.headers.set("Location", "/sign-in?status=unavailable"); }
      return result;
    },
    async callback(request: NextRequest) {
      const result = response("/sign-in?status=expired-link");
      const config = settings();
      const codes = request.nextUrl.searchParams.getAll("code");
      if (!config || codes.length !== 1 || !/^[A-Za-z0-9_-]{1,512}$/.test(codes[0])) return result;
      try {
        const client = createClient(request, result, config);
        const { error } = await client.auth.exchangeCodeForSession(codes[0]);
        if (!error && await verifySession(client)) result.headers.set("Location", `${config.appOrigin}${returnPath(request.nextUrl.searchParams.get("next"))}`);
      } catch { /* Fixed failure status; never echo codes, tokens or provider errors. */ }
      return result;
    },
    async signOut(request: NextRequest) {
      const config = settings();
      if (!config) return response("/sign-in?status=unavailable", 503);
      if (request.headers.get("origin") !== config.appOrigin) return response("/sign-in", 403);
      const result = response("/sign-in?status=signed-out");
      try { await createClient(request, result, config).auth.signOut({ scope: "local" }); }
      catch { /* Always end this browser's local session, even during provider failure. */ }
      for (const { name } of request.cookies.getAll()) {
        if (name === authCookieName || name.startsWith(`${authCookieName}.`) || name === `${authCookieName}-code-verifier`) {
          result.cookies.set(name, "", { ...cookieOptions(config), maxAge: 0 });
        }
      }
      return result;
    },
  };
}

export const authHandlers = createAuthHandlers();
