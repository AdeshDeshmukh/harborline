import { beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
let origin: string | null = "https://app.example.invalid";
vi.mock("next/headers", () => ({ headers: async () => new Headers(origin ? { origin } : {}) }));
vi.mock("../src/features/identity/config.server", () => ({ loadAuthConfig: () => ({ appOrigin: "https://app.example.invalid" }) }));
vi.mock("../src/features/identity/access.server", async importOriginal => ({
  ...await importOriginal<typeof import("../src/features/identity/access.server")>(), requireOwnerContext: async () => { throw new OwnerAccessError("unauthenticated"); },
}));
import { OwnerAccessError } from "../src/features/identity/access.server";
import { changePlan, previewAmount, refreshPlan } from "../src/app/(planning)/actions";
beforeEach(() => { origin = "https://app.example.invalid"; });
test.each(["https://evil.invalid", null])("planning actions reject origin %s before exposing account state", async value => {
  origin = value;
  for (const response of [await refreshPlan("scope"), await changePlan("scope", "savePolicy", {}), await previewAmount("scope", "100")]) expect(response).toMatchObject({ ok: false, code: "invalid_origin", reloadRequired: true });
});
test("same-origin server actions independently enforce a verified session", async () => {
  for (const response of [await refreshPlan("scope"), await changePlan("scope", "savePolicy", {}), await previewAmount("scope", "100")]) expect(response).toMatchObject({ ok: false, code: "unauthenticated", reloadRequired: true });
});
