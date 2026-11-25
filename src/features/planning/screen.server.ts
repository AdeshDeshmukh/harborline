import "server-only";
import { requireOwnerContext, OwnerAccessError, type OwnerContext } from "../identity/access.server";
import { createPlanningService } from "./service.server";
import { createPlanningRepository } from "./repository.server";
import { createCalculationStore } from "./snapshots.server";
import type { CalculationSnapshot } from "./snapshot-types";
import type { PlanView } from "./storage-types";
import type { HypotheticalView, PlanningFailure, PlanningResponse, PlanningScreen } from "./screen-types";
import { PlanningStoreError } from "./storage-errors";
import { PlanningValidationError } from "./errors";
import { compareAmounts, parseAmount, subtractAmounts } from "./money";
import { localDateAt, validateTimezone, validateCommitmentAmount } from "./validation";

type CalculationReader = {
  latest: (context: OwnerContext) => Promise<CalculationSnapshot | null>;
  recordFixtureBalance: (context: OwnerContext, input: { available: string; listingId: string; chain: string; venue: string }) => Promise<{ id: string }>;
  capture: (context: OwnerContext, input: { expectedRevision: number; balanceSnapshotId: string }) => Promise<CalculationSnapshot>;
};
type Dependencies = { owner?: typeof requireOwnerContext; planning?: () => ReturnType<typeof createPlanningService>; calculations?: () => CalculationReader };
export function projectHypothetical(before: string, amount: unknown): HypotheticalView {
  const budget = parseAmount(before), spend = validateCommitmentAmount(amount);
  return { amount: spend, before: budget, after: compareAmounts(budget, spend) >= 0 ? subtractAmounts(budget, spend) : null,
    exceedsBy: compareAmounts(budget, spend) < 0 ? subtractAmounts(spend, budget) : null };
}
function failure(error: unknown): PlanningFailure {
  if (error instanceof SessionChangedError) return { ok: false, code: "session_changed", message: "The signed-in account changed. Open the current account’s plan before editing.", reloadRequired: true };
  if (error instanceof OwnerAccessError && error.code === "unauthenticated") return { ok: false, code: "unauthenticated", message: "Your session ended. Sign in again to continue.", reloadRequired: true };
  if (error instanceof PlanningValidationError) return { ok: false, code: error.code, message: error.message, reloadRequired: false };
  if (error instanceof PlanningStoreError && error.code !== "unavailable") return { ok: false, code: error.code, message: error.message,
    reloadRequired: ["conflict", "not_found", "operation_in_progress"].includes(error.code) };
  return { ok: false, code: "unavailable", message: "We could not confirm this request. Reload your plan before trying again.", reloadRequired: true };
}
class SessionChangedError extends Error {}
function assertScope(context: OwnerContext, scope: unknown) { if (scope !== context.accountId) throw new SessionChangedError(); }
export function createPlanningController(deps: Dependencies = {}) {
  const owner = deps.owner ?? requireOwnerContext;
  const planning = deps.planning ?? (() => createPlanningService(createPlanningRepository()));
  const calculations = deps.calculations ?? (() => createCalculationStore());
  async function screen(context: OwnerContext, plan: PlanView, refresh = true): Promise<PlanningScreen> {
    const result: PlanningScreen = { scope: context.accountId, plan, snapshot: null, calculationError: null, hypothetical: null };
    if (!plan.policy) return result;
    try {
      const store = calculations();
      if (!refresh) {
        const previous = await store.latest(context);
        if (previous && previous.policyRevision === plan.revision && previous.input.timezone === context.timezone &&
          previous.input.asOfLocalDate === localDateAt(new Date(), validateTimezone(context.timezone))) result.snapshot = previous;
        else result.calculationError = "Reload the sample to create an explanation for this plan.";
        return result;
      }
      const balance = await store.recordFixtureBalance(context, { available: "2000", listingId: "fixture-usdc", chain: "fixture-chain", venue: "fixture-venue" });
      result.snapshot = await store.capture(context, { expectedRevision: plan.revision, balanceSnapshotId: balance.id });
    } catch {
      result.calculationError = "Your plan is saved, but its explanation could not be refreshed. Reload to try again.";
    }
    return result;
  }
  return {
    async load(): Promise<PlanningResponse> {
      try { const context = await owner(); return { ok: true, screen: await screen(context, await planning().get(context), false) }; }
      catch (error) { return failure(error); }
    },
    async refresh(scope: unknown): Promise<PlanningResponse> {
      try { const context = await owner(); assertScope(context, scope); return { ok: true, screen: await screen(context, await planning().get(context)) }; }
      catch (error) { return failure(error); }
    },
    async mutate(scope: unknown, kind: unknown, input: unknown): Promise<PlanningResponse> {
      try {
        const context = await owner(); assertScope(context, scope);
        if (kind !== "savePolicy" && kind !== "createCommitment" && kind !== "updateCommitment" && kind !== "removeCommitment") throw new PlanningStoreError("invalid_request");
        const plan = await planning()[kind](context, input);
        return { ok: true, screen: await screen(context, plan) };
      } catch (error) { return failure(error); }
    },
    async preview(scope: unknown, amount: unknown): Promise<PlanningResponse> {
      try {
        const context = await owner(); assertScope(context, scope);
        const spend = validateCommitmentAmount(amount);
        const result = await screen(context, await planning().get(context));
        if (result.snapshot) result.hypothetical = projectHypothetical(result.snapshot.result.debitBudget, spend);
        return { ok: true, screen: result };
      } catch (error) { return failure(error); }
    },
  };
}
