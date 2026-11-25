import "server-only";
import type { OwnerContext } from "../identity/access.server";
import { ApprovalError, type ApprovalReceipt } from "./approval-types";
import type { createApprovalRepository } from "./approvals.server";
import { normalizeApprovalCommand } from "./approval-command";

/** Fixture harness only. HL-24 owns any signer, HTTP endpoint and live orchestration. */
export function createFixtureApprovalService(options: {
  source?: "contract_fixture" | "provider";
  approvals: ReturnType<typeof createApprovalRepository>;
  refreshFixtureEvidence: (context: OwnerContext) => Promise<unknown>;
  fixtureExecutor: (receipt: ApprovalReceipt) => Promise<void>;
}) {
  return {
    async approve(context: OwnerContext, value: unknown): Promise<ApprovalReceipt> {
      if (options.source !== "contract_fixture") throw new ApprovalError("disabled");
      const command = normalizeApprovalCommand(value);
      const replay = await options.approvals.get(context, command);
      if (replay) return replay;
      let evidence: unknown;
      try { evidence = await options.refreshFixtureEvidence(context); }
      catch { throw new ApprovalError("unavailable"); }
      const claim = await options.approvals.approve(context, command, evidence);
      if (!claim.accepted) return claim;
      // The approval/attempt and SUBMITTING state are committed before this
      // boundary. A crash here holds the slot; replays NEVER dispatch again.
      try { await options.fixtureExecutor(claim); }
      catch {
        try {
          const unknown = await options.approvals.markFixtureUnknown(context, command, claim.attemptId);
          return Object.freeze({ ...unknown, accepted: true });
        } catch {
          // A claim already committed and the callback ran. Never report a
          // pre-approval rejection (e.g. disabled) for this uncertain outcome.
          throw new ApprovalError("unavailable");
        }
      }
      // No fabricated fill/success: a fixture callback is not a completed trade.
      return claim;
    },
  };
}
