import "server-only";
import { isAssignedCountryCode } from "./country-codes";
import { isUuid } from "../../server/env";
import { isSolanaAddress } from "./solana-address";
import { addAmounts, parseAmount } from "../../features/planning/money";
import { ReadContractError, SOLANA_USDC_MINT, type BackendAvailability, type CashBalance, type RouteIdentity, type SupportedAsset, type SupportedAssets } from "./read-types";

function invalid(): never { throw new ReadContractError("invalid_response"); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return invalid();
  return value;
}
function id(value: unknown): string { if (!isUuid(value)) return invalid(); return value.toLowerCase(); }
function page(value: unknown): Record<string, unknown>[] {
  const row = object(value);
  if (!Array.isArray(row.data) || row.data.length > 10000) return invalid();
  if (row.pagination !== undefined && object(row.pagination).next_cursor !== null) return invalid();
  return row.data.map(object);
}
export function validateRoute(value: RouteIdentity): RouteIdentity {
  if (!value || !isSolanaAddress(value.stockAddress) || value.stockAddress === SOLANA_USDC_MINT || id(value.stockId) === id(value.cashId)) throw new ReadContractError("unsupported_route");
  return Object.freeze({ stockId: id(value.stockId), stockAddress: value.stockAddress, cashId: id(value.cashId) });
}
function asset(row: Record<string, unknown>, cash: boolean, route: RouteIdentity): SupportedAsset {
  if (row.chain !== "solana" || row.venue !== "defi" || row.type !== "spot" || row.status !== "active" || row.is_active === false ||
    row.asset_class !== (cash ? "crypto" : "stock") || row.stable !== cash || typeof row.tradeable !== "boolean" || (!cash && row.tradeable !== true) ||
    !Number.isInteger(row.decimals) || (row.decimals as number) < 0 || (row.decimals as number) > 18 || (cash && row.decimals !== 6) ||
    row.address !== (cash ? SOLANA_USDC_MINT : route.stockAddress) || !Array.isArray(row.order_types) ||
    !row.order_types.every(type => typeof type === "string" && type.length > 0 && type.length <= 40) || (!cash && !row.order_types.includes("market")) ||
    !Array.isArray(row.networks)) throw new ReadContractError("unsupported_route");
  for (const raw of row.networks) {
    const network = object(raw); text(network.network);
    if (!Array.isArray(network.compatible_networks) || !network.compatible_networks.includes(network.network)) return invalid();
    network.compatible_networks.forEach(text);
  }
  const symbol = text(row.symbol), name = text(row.name);
  if (cash && symbol !== "USDC") throw new ReadContractError("unsupported_route");
  return Object.freeze({ id: id(row.id), address: row.address as string, symbol, name, decimals: row.decimals as number,
    chain: "solana", venue: "defi", type: "spot", assetClass: cash ? "crypto" : "stock", stable: cash, tradeable: row.tradeable as boolean });
}
export function normalizeAssets(value: unknown, rawRoute: RouteIdentity): SupportedAssets {
  const route = validateRoute(rawRoute), rows = page(value), seen = new Set<string>();
  for (const row of rows) { const key = id(row.id); if (seen.has(key)) return invalid(); seen.add(key); }
  const stock = rows.filter(row => id(row.id) === route.stockId), cash = rows.filter(row => id(row.id) === route.cashId);
  if (stock.length !== 1 || cash.length !== 1) throw new ReadContractError("unsupported_route");
  return Object.freeze({ stock: asset(stock[0], false, route), cash: asset(cash[0], true, route) });
}
export function normalizeCashBalance(value: unknown, cashId: string): CashBalance {
  const selectedId = id(cashId), rows = page(value);
  // An ID belongs to one listing. Conflicting copies cannot be silently ignored.
  const matching = rows.filter(row => typeof row.asset_id === "string" && row.asset_id.toLowerCase() === selectedId);
  if (matching.length !== 1) throw new ReadContractError("unsupported_route");
  const row = matching[0];
  if (row.chain !== "solana" || row.venue !== "defi" || row.address !== SOLANA_USDC_MINT || row.symbol !== "USDC" || row.decimals !== 6 || row.stable !== true || typeof row.tradeable !== "boolean") return invalid();
  try {
    const amount = (value: unknown) => parseAmount(parseAmount(value), { scale: 6 });
    const available = amount(row.available), held = amount(row.held), total = amount(row.total);
    if (addAmounts([available, held]) !== total) return invalid();
    const allocated = row.allocated === undefined ? null : amount(row.allocated);
    return Object.freeze({ assetId: selectedId, address: SOLANA_USDC_MINT, chain: "solana", venue: "defi", decimals: 6, available, held, total, allocated });
  } catch { return invalid(); }
}
export function restrictedCountries(value: unknown): string[] {
  const selectors = { venue: ["defi", "cefi"], product_type: ["spot", "perp"], asset_class: ["crypto", "stock"] };
  const selected = { venue: "defi", product_type: "spot", asset_class: "stock" };
  const countries = new Set<string>();
  for (const rule of page(value)) {
    const keys = Object.keys(rule).filter(key => key !== "countries");
    if (keys.length !== 1 || !Object.hasOwn(selectors, keys[0])) return invalid();
    const key = keys[0] as keyof typeof selectors;
    if (!selectors[key].includes(rule[key] as string) || !Array.isArray(rule.countries) || rule.countries.length > 300) return invalid();
    for (const raw of rule.countries) {
      const country = object(raw); text(country.name);
      if (!isAssignedCountryCode(country.code)) return invalid();
      if (rule[key] === selected[key]) countries.add(country.code);
    }
  }
  return [...countries].sort();
}
export function normalizeAvailability(value: unknown): BackendAvailability {
  const row = object(value);
  if (!isAssignedCountryCode(row.country) ||
    !Array.isArray(row.allowed_product_types) || !row.allowed_product_types.every(value => ["spot", "perp"].includes(value)) ||
    !Array.isArray(row.allowed_asset_classes) || !row.allowed_asset_classes.every(value => ["crypto", "stock"].includes(value))) return invalid();
  return Object.freeze({ country: row.country, productTypes: Object.freeze([...new Set(row.allowed_product_types)]), assetClasses: Object.freeze([...new Set(row.allowed_asset_classes)]) });
}
