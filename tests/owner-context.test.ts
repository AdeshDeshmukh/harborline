import { beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/features/identity/session.server", () => ({ getVerifiedSession: vi.fn() }));
vi.mock("../src/features/accounts/repository.server", () => ({ bootstrapAccount: vi.fn() }));
import { getVerifiedSession } from "../src/features/identity/session.server";
import { bootstrapAccount } from "../src/features/accounts/repository.server";
import { requireOwnerContext } from "../src/features/identity/access.server";

const identity = { id: "44444444-4444-4444-8444-444444444444", email: "builder@example.invalid" };
const account = { accountId: "55555555-5555-4555-8555-555555555555", ownerId: identity.id,
  externalRefId: "hl_synthetic", providerUserId: null, provisioningState: "UNPROVISIONED" as const,
  pilotEnabled: false, eligibilityStatus: "UNKNOWN" as const, timezone: "UTC" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getVerifiedSession).mockResolvedValue(identity);
  vi.mocked(bootstrapAccount).mockResolvedValue(account);
});

test("missing verified session denies access before database bootstrap", async () => {
  vi.mocked(getVerifiedSession).mockResolvedValue(null);
  await expect(requireOwnerContext()).rejects.toMatchObject({ code: "unauthenticated" });
  expect(bootstrapAccount).not.toHaveBeenCalled();
});

test("owner context derives identity and mapping from the server, ignoring all caller IDs", async () => {
  const untrusted = { ownerId: "attacker", accountId: "another-account", providerUserId: "another-provider" };
  // Deliberately invoke JS with extra arguments: none are part of the API.
  const context = await Reflect.apply(requireOwnerContext, null, [untrusted]);
  expect(context).toMatchObject({ ...account, email: identity.email });
  expect(bootstrapAccount).toHaveBeenCalledExactlyOnceWith(identity);
  expect(Object.isFrozen(context)).toBe(true);
});

test("different verified sessions resolve their own owner context without a global session cache", async () => {
  const first = await requireOwnerContext();
  const secondIdentity = { id: "66666666-6666-4666-8666-666666666666", email: "second@example.invalid" };
  vi.mocked(getVerifiedSession).mockResolvedValue(secondIdentity);
  vi.mocked(bootstrapAccount).mockResolvedValue({ ...account, ownerId: secondIdentity.id, accountId: "77777777-7777-4777-8777-777777777777", externalRefId: "hl_second" });
  const second = await requireOwnerContext();
  expect(second.ownerId).toBe(secondIdentity.id);
  expect(second.accountId).not.toBe(first.accountId);
  expect(first.ownerId).toBe(identity.id);
});

test("database failure is sanitized and never produces a usable context", async () => {
  vi.mocked(bootstrapAccount).mockRejectedValue(new Error("private connection string or query"));
  await expect(requireOwnerContext()).rejects.toMatchObject({ code: "account_unavailable", message: "Account is temporarily unavailable" });
});

test("an inconsistent database owner mapping fails closed", async () => {
  vi.mocked(bootstrapAccount).mockResolvedValue({ ...account, ownerId: "66666666-6666-4666-8666-666666666666" });
  await expect(requireOwnerContext()).rejects.toMatchObject({ code: "account_unavailable" });
});
