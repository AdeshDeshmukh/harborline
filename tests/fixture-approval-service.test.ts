import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { createApprovalRepository } from "../src/features/orders/approvals.server";
import { createFixtureApprovalService } from "../src/features/orders/approve.server";
import type { OwnerContext } from "../src/features/identity/access.server";
const owner = {} as OwnerContext;
test.each([undefined, "provider"] as const)("source %s fails before evidence or executor dependencies", async source => {
  const fail = async (): Promise<never> => { throw new Error("dependency must not run"); };
  const service = createFixtureApprovalService({ source, approvals: { get: fail, approve: fail } as unknown as ReturnType<typeof createApprovalRepository>, refreshFixtureEvidence: fail, fixtureExecutor: fail });
  await expect(service.approve(owner, {})).rejects.toMatchObject({ code: "disabled" });
});
