import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeApprovalCommand } from "../src/features/orders/approval-command";

const command = { intentId: "ABCDEFAB-1234-4567-8901-ABCDEFABCDEF", reviewRevision: 1, termsHash: "a".repeat(64), acknowledged: true };
test("approval accepts only an exact acknowledged immutable review reference", () => {
  expect(normalizeApprovalCommand(command)).toEqual({ ...command, intentId: command.intentId.toLowerCase() });
});
test.each([null, [], {}, { ...command, acknowledged: false }, { ...command, intentId: "other" },
  { ...command, reviewRevision: 1.5 }, { ...command, reviewRevision: 0 }, { ...command, reviewRevision: 2147483648 },
  { ...command, termsHash: "A".repeat(64) }, { ...command, termsHash: "a".repeat(63) }, { ...command, termsHash: "a".repeat(64) + "\n" },
  ...["ownerId", "accountId", "payloads", "maximumDebit", "source", "enabled", "balance"].map(key => ({ ...command, [key]: "injected" })),
])("rejects incomplete, unacknowledged or caller-supplied authority %j", value => {
  expect(() => normalizeApprovalCommand(value)).toThrow(expect.objectContaining({ code: "invalid_request" }));
});
