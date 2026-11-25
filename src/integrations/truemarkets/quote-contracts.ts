import "server-only";
import { createHash } from "node:crypto";
import { isUuid } from "../../server/env";
import { addAmounts, compareAmounts, parseAmount } from "../../features/planning/money";
import { SOLANA_USDC_MINT } from "./read-types";
import { isSolanaAddress } from "./solana-address";
import { QuoteContractError, type DefiQuote, type PricePreview, type QuoteAssessment, type QuoteCode, type QuoteContext, type QuoteIdentity } from "./quote-types";

function reject(code: QuoteCode = "invalid_quote"): never { throw new QuoteContractError(code); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[]) {
  const record = object(value);
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return reject();
  return record;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return reject();
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return reject();
  return Date.parse(value);
}
function amount(value: unknown, scale: number, positive = false) { return parseAmount(parseAmount(value), { scale, positive }); }
function identity(context: QuoteContext): QuoteIdentity {
  const ctx = object(context), assets = object(ctx.assets), stock = object(assets.stock), cash = object(assets.cash);
  if ((ctx.source !== "contract_fixture" && ctx.source !== "provider") || ctx.side !== "buy" || ctx.qtyUnit !== "quote" ||
    !isUuid(stock.id) || !isUuid(cash.id) || stock.id.toLowerCase() === cash.id.toLowerCase() || typeof stock.address !== "string" || !isSolanaAddress(stock.address) || stock.address === SOLANA_USDC_MINT ||
    cash.address !== SOLANA_USDC_MINT || stock.chain !== "solana" || cash.chain !== "solana" || stock.venue !== "defi" || cash.venue !== "defi" ||
    stock.type !== "spot" || cash.type !== "spot" || stock.assetClass !== "stock" || cash.assetClass !== "crypto" ||
    stock.stable !== false || cash.stable !== true || stock.tradeable !== true || typeof cash.tradeable !== "boolean" ||
    !Number.isInteger(stock.decimals) || (stock.decimals as number) < 0 || (stock.decimals as number) > 18 || cash.decimals !== 6 || cash.symbol !== "USDC") return reject("unsupported_route");
  timestamp(ctx.observedAt);
  const baseIdentifier = label(ctx.baseIdentifier), quoteIdentifier = label(ctx.quoteIdentifier);
  const baseAliases = [label(stock.symbol), stock.id.toLowerCase(), stock.address];
  const cashAliases = ["USDC", cash.id.toLowerCase(), SOLANA_USDC_MINT];
  if (!baseAliases.includes(baseIdentifier) || !cashAliases.includes(quoteIdentifier) ||
    cashAliases.includes(baseIdentifier) || baseAliases.includes(quoteIdentifier)) return reject("unsupported_route");
  return { source: ctx.source, observedAt: ctx.observedAt as string, stockId: stock.id.toLowerCase(), stockAddress: stock.address,
    cashId: cash.id.toLowerCase(), baseDecimals: stock.decimals as number, baseIdentifier, quoteIdentifier,
    requestedAmount: amount(ctx.requestedAmount, 6, true), chain: "solana", venue: "defi" };
}
function guarded<T>(work: () => T): T {
  try { return work(); } catch (error) { if (error instanceof QuoteContractError) throw error; return reject(); }
}
function fingerprint(quote: Omit<DefiQuote, "fingerprint">) {
  return createHash("sha256").update(JSON.stringify([quote.source, quote.observedAt, quote.stockId, quote.stockAddress, quote.cashId,
    quote.baseDecimals, quote.baseIdentifier, quote.quoteIdentifier, quote.requestedAmount, quote.chain, quote.venue,
    quote.inputAmount, quote.expectedOutput, quote.feeAmount, quote.feeAssetId, quote.issues])).digest("hex");
}
export function normalizePricePreview(value: unknown, context: QuoteContext): PricePreview {
  return guarded(() => {
    const route = identity(context), row = exact(value, ["qty", "price", "notional", "fee"]);
    const expectedBaseQuantity = amount(row.qty, route.baseDecimals, true), price = amount(row.price, 18, true);
    const notional = amount(row.notional, 6, true), feeAmount = amount(row.fee, 6);
    if (compareAmounts(notional, parseAmount(route.requestedAmount)) > 0) return reject();
    // Documented QuoteResponse buy fee semantics; still only an estimate.
    return Object.freeze({ ...route, kind: "nonbinding_preview", expectedBaseQuantity, price, notional, feeAmount,
      feeAssetId: route.cashId, estimatedDebit: addAmounts([notional, feeAmount]), maximumDebit: null, expiresAt: null, canAuthorize: false });
  });
}
export function normalizeDefiQuote(value: unknown, context: QuoteContext): DefiQuote {
  return guarded(() => {
    const route = identity(context), row = exact(value, ["base_asset", "quote_asset", "qty", "qty_out", "fee", "fee_asset", "issues"]);
    if (row.base_asset !== route.baseIdentifier || row.quote_asset !== route.quoteIdentifier) return reject("unsupported_route");
    if (row.fee_asset !== route.quoteIdentifier) return reject("fee_asset_mismatch");
    if (!Array.isArray(row.issues) || row.issues.length > 20) return reject();
    const issues = Object.freeze(row.issues.map(label));
    const inputAmount = amount(row.qty, 6, true), expectedOutput = amount(row.qty_out, route.baseDecimals, true), feeAmount = amount(row.fee, 6);
    if (inputAmount !== route.requestedAmount) return reject();
    const quote = { ...route, kind: "defi_quote_information" as const, inputAmount, expectedOutput, feeAmount, feeAssetId: route.cashId, issues, canAuthorize: false as const };
    return Object.freeze({ ...quote, fingerprint: fingerprint(quote) });
  });
}
export function assessFixtureTerms(quote: DefiQuote, evidence: unknown, debitBudget: unknown, now: Date): QuoteAssessment {
  const blocked = (reason: QuoteCode): QuoteAssessment => Object.freeze({ kind: "blocked", reason, canAuthorize: false });
  try {
    // This is intentionally not a generic provider authorization validator.
    if (quote.source === "provider") return blocked("unverified_provider_contract");
    if (quote.source !== "contract_fixture" || quote.kind !== "defi_quote_information" || fingerprint(quote) !== quote.fingerprint) return blocked("terms_mismatch");
    if (quote.issues.length > 0) return blocked("quote_issues");
    if (evidence === null || evidence === undefined) return blocked("unverified_terms");
    const terms = exact(evidence, ["source", "quoteFingerprint", "contractRef", "maximumDebit", "expiresAt", "feeTreatment"]);
    if (terms.source !== "contract_fixture" || !label(terms.contractRef) || (terms.feeTreatment !== "added_to_input" && terms.feeTreatment !== "included_in_input")) return blocked("invalid_evidence");
    if (terms.quoteFingerprint !== quote.fingerprint) return blocked("terms_mismatch");
    const observed = timestamp(quote.observedAt), expiry = timestamp(terms.expiresAt), current = now instanceof Date ? now.getTime() : NaN;
    const deadline = Math.min(observed + 20_000, expiry);
    if (!Number.isFinite(current) || current < observed || current >= deadline) return blocked("stale_quote");
    const cap = amount(terms.maximumDebit, 6, true), budget = amount(debitBudget, 6);
    const input = amount(quote.inputAmount, 6, true), fee = amount(quote.feeAmount, 6);
    if (terms.feeTreatment === "included_in_input" && compareAmounts(fee, input) >= 0) return blocked("inconsistent_bound");
    const minimum = terms.feeTreatment === "added_to_input" ? addAmounts([input, fee]) : input;
    if (compareAmounts(cap, minimum) < 0) return blocked("inconsistent_bound");
    if (compareAmounts(cap, budget) > 0) return blocked("debit_exceeds_allowance");
    return Object.freeze({ kind: "bounded_fixture", source: "contract_fixture", quoteFingerprint: quote.fingerprint,
      maximumDebit: cap, validUntil: new Date(deadline).toISOString(), feeTreatment: terms.feeTreatment, canAuthorize: false });
  } catch { return blocked("invalid_evidence"); }
}
