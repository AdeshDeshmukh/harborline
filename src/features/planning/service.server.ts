import "server-only";
import type { OwnerContext } from "../identity/access.server";
import type { CommitmentFields, PlanningRepository } from "./storage-types";
import { PlanningStoreError } from "./storage-errors";
import { validateBufferAmount, validateCalendarDate, validateCommitmentAmount, validateHorizonDays } from "./validation";
import { isUuid } from "../../server/env";

export function createPlanningService(repository: PlanningRepository) {
  return {
    get: (context: OwnerContext) => repository.get(context),
    async savePolicy(context: OwnerContext, input: unknown) {
      const value = body(input, ["expectedRevision", "horizonDays", "additionalBuffer", "acknowledged"]);
      if (value.acknowledged !== true) throw new PlanningStoreError("invalid_request");
      return repository.mutate(context, { kind: "save_policy", expectedRevision: revision(value.expectedRevision),
        horizonDays: validateHorizonDays(value.horizonDays), additionalBuffer: validateBufferAmount(value.additionalBuffer) });
    },
    async createCommitment(context: OwnerContext, input: unknown) {
      const value = body(input, ["expectedRevision", "label", "amount", "dueDate"]);
      return repository.mutate(context, { kind: "create", expectedRevision: revision(value.expectedRevision),
        label: label(value.label), amount: validateCommitmentAmount(value.amount), dueDate: validateCalendarDate(value.dueDate) });
    },
    async updateCommitment(context: OwnerContext, input: unknown) {
      const value = body(input, ["expectedRevision", "id"], ["label", "amount", "dueDate", "status"]);
      const changes: Partial<CommitmentFields> = {};
      if (Object.hasOwn(value, "label")) changes.label = label(value.label);
      if (Object.hasOwn(value, "amount")) changes.amount = validateCommitmentAmount(value.amount);
      if (Object.hasOwn(value, "dueDate")) changes.dueDate = validateCalendarDate(value.dueDate);
      if (Object.hasOwn(value, "status")) {
        if (value.status !== "outstanding" && value.status !== "paid" && value.status !== "removed") throw new PlanningStoreError("invalid_request");
        changes.status = value.status;
      }
      if (!Object.keys(changes).length) throw new PlanningStoreError("invalid_request");
      return repository.mutate(context, { kind: "update", expectedRevision: revision(value.expectedRevision), id: identifier(value.id), changes });
    },
    async removeCommitment(context: OwnerContext, input: unknown) {
      const value = body(input, ["expectedRevision", "id"]);
      return repository.mutate(context, { kind: "remove", expectedRevision: revision(value.expectedRevision), id: identifier(value.id) });
    },
  };
}

function body(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new PlanningStoreError("invalid_request");
  return value as Record<string, unknown>;
}
function revision(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value >= 2147483647) throw new PlanningStoreError("invalid_request");
  return value;
}
function identifier(value: unknown) {
  if (!isUuid(value)) throw new PlanningStoreError("invalid_request");
  return value;
}
function label(value: unknown) {
  if (typeof value !== "string" || value.length > 120 || !value.trim() || [...value].some(character => {
    const code = character.codePointAt(0)!; return code < 32 || code >= 127 && code <= 159;
  })) throw new PlanningStoreError("invalid_request");
  return value.trim();
}
