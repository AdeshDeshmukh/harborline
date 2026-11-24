import { expect, test, vi } from "vitest";
import type { CookieMethodsServer } from "@supabase/ssr";
import { NextRequest, type NextResponse } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../src/features/identity/config.server", () => ({ loadAuthConfig: () => ({ appOrigin: "https://app.example.invalid" }) }));
vi.mock("../src/features/identity/supabase.server", () => ({
  createRouteAuthClient: (request: NextRequest, response: NextResponse) => ({ auth: { getUser: async () => {
    request.cookies.set("harborline-auth", "renewed");
    response.cookies.set("harborline-auth", "renewed");
  } } }),
  cookieOptions: () => ({ path: "/", httpOnly: true, secure: true, sameSite: "lax" }),
  createAuthClient: (_config: unknown, adapter: CookieMethodsServer) => ({ auth: { getUser: async () => {
    await adapter.setAll?.([{ name: "harborline-auth", value: "renewed", options: {} }], { "Cache-Control": "private, no-store", Expires: "0" });
  } } }),
}));
import { proxy } from "../src/proxy";

test("Proxy forwards refreshed cookies to the same request's server render and back to the browser", async () => {
  const request = new NextRequest("https://app.example.invalid/account", { headers: { Cookie: "harborline-auth=old" } });
  const result = await proxy(request);
  expect(result.cookies.get("harborline-auth")?.value).toBe("renewed");
  expect(result.headers.get("x-middleware-request-cookie")).toContain("harborline-auth=renewed");
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(result.headers.get("expires")).toBe("0");
});
