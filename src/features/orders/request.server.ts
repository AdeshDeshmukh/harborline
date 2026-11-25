import "server-only";
import { createHash } from "node:crypto";
import { isUuid } from "../../server/env";
import { parseAmount } from "../planning/money";
import { IntentStoreError, type IntentRequest } from "./types";
export function normalizeIntentRequest(value: unknown): { command: IntentRequest; hash: string } {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const row = { ...value } as Record<string, unknown>, keys = ["requestKey","operationKind","assetId","requestedQty","qtyUnit","calculationId","expectedPolicyRevision"];
    if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row,key)) || typeof row.requestKey !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(row.requestKey) ||
      !["buy","sell","exit"].includes(row.operationKind as string) || !isUuid(row.assetId) ||
      row.qtyUnit !== (row.operationKind === "buy" ? "quote" : "base") ||
      (row.calculationId !== null && !isUuid(row.calculationId)) || (row.operationKind === "buy" && row.calculationId === null) ||
      !Number.isInteger(row.expectedPolicyRevision) || (row.expectedPolicyRevision as number) < 1 || (row.expectedPolicyRevision as number) > 2147483647) throw new Error();
    const command: IntentRequest = Object.freeze({ requestKey: row.requestKey, operationKind: row.operationKind as IntentRequest["operationKind"], assetId: row.assetId.toLowerCase(),
      requestedQty: parseAmount(parseAmount(row.requestedQty),{scale:row.operationKind === "sell" ? 18 : 6,positive:true}),qtyUnit:row.qtyUnit as IntentRequest["qtyUnit"],
      calculationId: typeof row.calculationId === "string" ? row.calculationId.toLowerCase() : null, expectedPolicyRevision:row.expectedPolicyRevision as number });
    const hash = createHash("sha256").update(JSON.stringify([1,command.operationKind,command.assetId,command.requestedQty,command.qtyUnit,command.calculationId,command.expectedPolicyRevision])).digest("hex");
    return { command, hash };
  } catch { throw new IntentStoreError("invalid_request"); }
}
