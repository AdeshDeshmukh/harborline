import { expect, test } from "vitest";
import { normalizeRecoveryOrder } from "../src/integrations/truemarkets/recovery-contracts";
const binding = { providerOrderId: "fixture_order_1", providerUserId: "33333333-3333-4333-8333-333333333333", assetId: "11111111-1111-4111-8111-111111111111", requestedQty: "100", quoteAsset: "USDC", baseDecimals: 6 };
const order = () => ({ order_id: binding.providerOrderId, asset_id: binding.assetId, side: "buy", type: "market", qty: "100", qty_unit: "quote", venue: "defi", chain: "solana", quote_asset: "USDC", status: "pending", executed_qty: "0.4", leaves_qty: "0.1", fee: "0.2", executed_vwap: "200", failure_reason: "private text", payloads: ["do not expose"] });
test("projects actual base fill evidence without confusing quote-sized request units", () => {
  expect(normalizeRecoveryOrder(order(), binding)).toEqual({ providerStatus: "pending", filledBase: "0.4", remainingBase: "0.1", feeQuote: "0.2", averagePriceQuote: "200", partial: true });
});
test("missing fill evidence stays unknown rather than becoming zero or an estimate", () => {
  const value = order();
  delete (value as Partial<typeof value>).executed_qty;
  delete (value as Partial<typeof value>).leaves_qty;
  expect(normalizeRecoveryOrder(value, binding)).toMatchObject({ filledBase: null, remainingBase: null, partial: null });
});
test.each([{ order_id: "other" }, { asset_id: null }, { side: "sell" }, { qty_unit: "base" }, { qty: "0.5" }, { venue: "cefi" }, { chain: "base" }, { quote_asset: "PYUSD" }, { status: "partial" }, { executed_qty: "-1" }, { fee: "NaN" }, { executed_qty: "0.0000001" }, { status: "complete", leaves_qty: "0.1" }])("rejects mismatched or contradictory facts %j", fields => {
  expect(() => normalizeRecoveryOrder({ ...order(), ...fields }, binding)).toThrow();
});

test("harmless base precision padding is canonicalized before scale validation", () => {
 expect(normalizeRecoveryOrder({...order(),executed_qty:"0.50000000",leaves_qty:"0.00000000"},binding)).toMatchObject({filledBase:"0.5",remainingBase:"0"});
});
test.each([{executed_qty:"0",fee:"1"},{status:"initialized",executed_qty:"0.4",fee:"0"},{status:"initialized",executed_qty:null,fee:"1"}])("explicit unfilled actuals are contradictory: %j", fields => {
 expect(()=>normalizeRecoveryOrder({...order(),...fields},binding)).toThrow();
});
