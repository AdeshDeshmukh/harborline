import { isUuid } from "../../server/env";
import { ApprovalError, type ApprovalCommand } from "./approval-types";

export function normalizeApprovalCommand(value: unknown): ApprovalCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApprovalError("invalid_request");
  const v = value as Record<string, unknown>;
  const keys = ["intentId", "reviewRevision", "termsHash", "acknowledged"];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) ||
      typeof v.intentId !== "string" || !isUuid(v.intentId) ||
      typeof v.reviewRevision !== "number" || !Number.isInteger(v.reviewRevision) || v.reviewRevision < 1 || v.reviewRevision > 2147483647 ||
      typeof v.termsHash !== "string" || !/^[0-9a-f]{64}$/.test(v.termsHash) || v.acknowledged !== true) throw new ApprovalError("invalid_request");
  return Object.freeze({ intentId: v.intentId.toLowerCase(), reviewRevision: v.reviewRevision, termsHash: v.termsHash, acknowledged: true });
}
