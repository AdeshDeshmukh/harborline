import { afterEach, expect, test, vi } from "vitest";
import { POST } from "../src/app/api/account/provision/route";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test.each(["demo", "pilot"])("production provisioning remains unavailable in %s, without any provider call", async mode => {
  vi.stubEnv("APP_MODE", mode); vi.stubEnv("GATEWAY_PROVISIONING_ENABLED", "true");
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected provider call"));
  const response = await POST();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "provisioning_unavailable" });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(network).not.toHaveBeenCalled();
});
