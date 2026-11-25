import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeAssets, normalizeCashBalance, normalizeAvailability, restrictedCountries } from "../src/integrations/truemarkets/read-contracts";
import { SOLANA_USDC_MINT } from "../src/integrations/truemarkets/read-types";
const stockId = "11111111-1111-4111-8111-111111111111", cashId = "22222222-2222-4222-8222-222222222222";
const route = { stockId, cashId, stockAddress: "11111111111111111111111111111111" };
const stock = { id: stockId, address: route.stockAddress, symbol: "SAMPLE", name: "Sample stock", decimals: 6, chain: "solana", venue: "defi", type: "spot", asset_class: "stock", stable: false, status: "active", tradeable: true, networks: [], order_types: ["market"] };
const cash = { ...stock, id: cashId, address: SOLANA_USDC_MINT, symbol: "USDC", name: "USDC", asset_class: "crypto", stable: true, tradeable: false, order_types: [] };
const catalog = () => ({ data: [{ ...stock }, { ...cash }], pagination: { next_cursor: null } });
const balance = () => ({ data: [{ asset_id: cashId, address: SOLANA_USDC_MINT, symbol: "USDC", chain: "solana", venue: "defi", decimals: 6, stable: true, tradeable: false, available: "1500.000000", held: "100.000000", total: "1600.000000", allocated: "50.000000" }] });
test("one exact stock and native USDC listing normalize without treating cash as a buy listing", () => {
  const result = normalizeAssets(catalog(), route);
  expect(result.stock).toMatchObject({ id: stockId, assetClass: "stock", chain: "solana", tradeable: true });
  expect(result.cash).toMatchObject({ id: cashId, address: SOLANA_USDC_MINT, decimals: 6, tradeable: false });
  expect(Object.isFrozen(result.cash)).toBe(true);
});
test.each([{ chain: "base" }, { venue: "cefi" }, { status: "sell_only" }, { tradeable: false }, { asset_class: "crypto" }, { type: "perp" }, { address: SOLANA_USDC_MINT }, { decimals: 19 }, { order_types: [] }])("unsupported stock identity/availability fails closed: %j", fields => {
  const input = catalog(); Object.assign(input.data[0], fields);
  expect(() => normalizeAssets(input, route)).toThrow();
});
test("missing, duplicate, partial and malformed catalog evidence cannot select a route", () => {
  for (const data of [[stock], [stock, cash, cash], [null, stock, cash]]) expect(() => normalizeAssets({ data }, route)).toThrow();
  expect(() => normalizeAssets({ ...catalog(), pagination: { next_cursor: "more" } }, route)).toThrow();
  expect(() => normalizeAssets({ data: [stock, { ...cash, decimals: 18 }] }, route)).toThrow();
  expect(() => normalizeAssets({ data: [stock, { ...cash, address: route.stockAddress }] }, route)).toThrow();
});
test("available is already net of holds and allocation; neither is subtracted again", () => {
  expect(normalizeCashBalance(balance(), cashId)).toEqual({ assetId: cashId, address: SOLANA_USDC_MINT, chain: "solana", venue: "defi", decimals: 6, available: "1500", held: "100", total: "1600", allocated: "50" });
});
test("unrelated chains and economic identities never contribute to the selected balance", () => {
  const input = balance(); input.data.unshift({ ...input.data[0], asset_id: stockId, chain: "base", available: "9000", total: "9100" });
  expect(normalizeCashBalance(input, cashId).available).toBe("1500");
  expect(() => normalizeCashBalance({ data: [input.data[0]] }, cashId)).toThrow();
});
test("a duplicate selected listing with conflicting chain metadata is rejected rather than ignored", () => {
  const input = balance(); input.data.push({ ...input.data[0], chain: "base" });
  expect(() => normalizeCashBalance(input, cashId)).toThrow();
});
test.each(["NaN", "-1", "1e3", "1.0000001", 100, " 100", "01"])("malformed or excess-precision money is rejected: %s", amount => {
  const input = balance(); Object.assign(input.data[0], { available: amount });
  expect(() => normalizeCashBalance(input, cashId)).toThrow();
});
test("zero and harmless storage padding are accepted without inventing omitted allocation", () => {
  const input = balance(); Object.assign(input.data[0], { available: "0.000000000000000000", held: "0", total: "0" });
  delete (input.data[0] as Partial<typeof input.data[0]>).allocated;
  expect(normalizeCashBalance(input, cashId)).toMatchObject({ available: "0", held: "0", total: "0", allocated: null });
});
test("duplicate matching rows, unknown held funds and inconsistent totals block the balance", () => {
  const input = balance();
  expect(() => normalizeCashBalance({ data: [...input.data, ...input.data] }, cashId)).toThrow();
  expect(() => normalizeCashBalance({ data: [{ ...input.data[0], held: undefined }] }, cashId)).toThrow();
  expect(() => normalizeCashBalance({ data: [{ ...input.data[0], total: "1599" }] }, cashId)).toThrow();
  expect(() => normalizeCashBalance({ data: [{ ...input.data[0], address: route.stockAddress }] }, cashId)).toThrow();
});
test("all matching restriction rules combine while irrelevant rules remain separate", () => {
  const countries = (codes: string[]) => codes.map(code => ({ code, name: `Fixture ${code}` }));
  expect(restrictedCountries({ data: [{ asset_class: "stock", countries: countries(["US", "GB"]) }, { venue: "defi", countries: countries(["CA", "US"]) }, { product_type: "perp", countries: countries(["DE"]) }] })).toEqual(["CA", "GB", "US"]);
});
test("unknown restriction selectors and malformed allowlists cannot become permission", () => {
  for (const rule of [{ future_selector: "stock", countries: [] }, { venue: "defi", asset_class: "stock", countries: [] }, { asset_class: "stock", countries: [{ code: "us", name: "US" }] }]) expect(() => restrictedCountries({ data: [rule] })).toThrow();
  expect(() => normalizeAvailability({ country: "XX", allowed_product_types: [], allowed_asset_classes: [] })).toThrow();
  expect(() => normalizeAvailability({ country: "DE", allowed_product_types: ["unknown"], allowed_asset_classes: ["stock"] })).toThrow();
});
test("backend availability retains its caller country without asserting end-user eligibility", () => {
  expect(normalizeAvailability({ country: "DE", allowed_product_types: ["spot"], allowed_asset_classes: ["stock"] })).toEqual({ country: "DE", productTypes: ["spot"], assetClasses: ["stock"] });
});

test("unassigned two-letter codes cannot pass availability or restriction parsing",()=>{
 expect(()=>normalizeAvailability({country:"AA",allowed_product_types:["spot"],allowed_asset_classes:["stock"]})).toThrow();
 expect(()=>restrictedCountries({data:[{asset_class:"stock",countries:[{code:"AA",name:"Unknown"}]}]})).toThrow();
});
