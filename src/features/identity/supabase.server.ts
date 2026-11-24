import "server-only";
import { createServerClient, type CookieMethodsServer, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import type { AuthConfig } from "./config.server";

export const authCookieName = "harborline-auth";
export function cookieOptions(config: AuthConfig): CookieOptions {
  return { path: "/", httpOnly: true, sameSite: "lax", secure: config.appOrigin.startsWith("https:"), domain: undefined };
}

export function createAuthClient(config: AuthConfig, cookies: CookieMethodsServer, fetcher: typeof fetch = fetch) {
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { name: authCookieName, ...cookieOptions(config) },
    cookies,
    global: { fetch: (url, init) => fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) }) },
  });
}

export function createRouteAuthClient(request: NextRequest, response: NextResponse, config: AuthConfig) {
  return createAuthClient(config, {
    getAll: () => request.cookies.getAll(),
    setAll: (values, headers) => {
      for (const { name, value, options } of values) {
        request.cookies.set(name, value);
        response.cookies.set(name, value, { ...options, ...cookieOptions(config) });
      }
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    },
  });
}
