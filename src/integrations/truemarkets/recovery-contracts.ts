import { RecoveryError, providerOrderStatuses, type ProviderOrderStatus, type RecoveryBinding, type RecoveryEvidence } from "../../features/orders/recovery-types";
import { compareAmounts, parseAmount } from "../../features/planning/money";
export function normalizeRecoveryOrder(value: unknown, binding: RecoveryBinding): RecoveryEvidence {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isInteger(binding.baseDecimals) || binding.baseDecimals < 0 || binding.baseDecimals > 18)
      throw new Error();
    const r = value as Record<string, unknown>;
    if (r.order_id !== binding.providerOrderId || r.asset_id !== binding.assetId || r.side !== "buy" || r.type !== "market" || r.qty_unit !== "quote" || r.venue !== "defi" || r.chain !== "solana" || r.quote_asset !== binding.quoteAsset || parseAmount(r.qty) !== parseAmount(binding.requestedQty) || !providerOrderStatuses.includes(r.status as ProviderOrderStatus) || r.asset_type !== undefined && r.asset_type !== "spot")
      throw new Error();
    const amount = (field: string, scale = 18) => r[field] === undefined || r[field] === null ? null : parseAmount(parseAmount(r[field]), { scale });
    const filledBase = amount("executed_qty", binding.baseDecimals), remainingBase = amount("leaves_qty", binding.baseDecimals), averagePriceQuote = amount("executed_vwap"), feeQuote = amount("fee"), providerStatus = r.status as ProviderOrderStatus;
    if (providerStatus === "complete" && (filledBase === "0" || remainingBase !== null && remainingBase !== "0"))
      throw new Error();
    if (filledBase === "0" && feeQuote !== null && feeQuote !== "0" || providerStatus === "initialized" && (filledBase !== null && filledBase !== "0" || feeQuote !== null && feeQuote !== "0"))
      throw new Error();
    const partial = filledBase === null || remainingBase === null ? null : compareAmounts(filledBase, parseAmount("0")) > 0 && compareAmounts(remainingBase, parseAmount("0")) > 0;
    return Object.freeze({ providerStatus, filledBase, remainingBase, averagePriceQuote, feeQuote, partial });
  }
  catch {
    throw new RecoveryError("invalid_request");
  }
}
