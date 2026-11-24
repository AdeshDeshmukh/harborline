import { beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/features/identity/access.server", async importOriginal => ({
  ...await importOriginal<typeof import("../src/features/identity/access.server")>(), requireOwnerContext: vi.fn(),
}));
import { requireOwnerContext, OwnerAccessError, type OwnerContext } from "../src/features/identity/access.server";
import { getAccountPageContext } from "../src/app/account/context.server";
beforeEach(() => { vi.resetAllMocks(); });

test("account navigation redirects a missing verified identity to sign-in", async () => {
  vi.mocked(requireOwnerContext).mockRejectedValue(new OwnerAccessError("unauthenticated"));
  await expect(getAccountPageContext()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/sign-in;307;" });
});

test("database unavailability produces a recoverable account state instead of a redirect loop", async () => {
  vi.mocked(requireOwnerContext).mockRejectedValue(new OwnerAccessError("account_unavailable"));
  await expect(getAccountPageContext()).resolves.toBeNull();
});

test("account navigation returns only the verified owner context", async () => {
  const context = { ownerId: "44444444-4444-4444-8444-444444444444", accountId: "55555555-5555-4555-8555-555555555555",
    externalRefId: "hl_synthetic", email: "builder@example.invalid", providerUserId: null,
    provisioningState: "UNPROVISIONED", pilotEnabled: false, eligibilityStatus: "UNKNOWN", timezone: "UTC" } as OwnerContext;
  vi.mocked(requireOwnerContext).mockResolvedValue(context);
  await expect(getAccountPageContext()).resolves.toBe(context);
});
