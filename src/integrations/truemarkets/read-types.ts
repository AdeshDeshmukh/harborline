export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export type ReadSource = "contract_fixture" | "provider";
export type RouteIdentity = Readonly<{ stockId: string; stockAddress: string; cashId: string }>;
export type SupportedAsset = Readonly<{ id: string; address: string; symbol: string; name: string; decimals: number; chain: "solana"; venue: "defi"; type: "spot"; assetClass: "stock" | "crypto"; stable: boolean; tradeable: boolean }>;
export type SupportedAssets = Readonly<{ stock: SupportedAsset; cash: SupportedAsset }>;
export type CashBalance = Readonly<{ assetId: string; address: string; chain: "solana"; venue: "defi"; decimals: 6; available: string; total: string; held: string; allocated: string | null }>;
export type BackendAvailability = Readonly<{ country: string; productTypes: readonly string[]; assetClasses: readonly string[] }>;
export type ReadCode = "invalid_response" | "unsupported_route" | "restricted" | "eligibility_unverified" | "wrong_owner" | "account_not_ready" | "stale_evidence" | "unavailable" | "integration_unverified" | "invalid_request";
const messages: Record<ReadCode,string> = {
  invalid_response: "Provider data could not be verified", unsupported_route: "The supported asset route is unavailable",
  restricted: "The asset route is restricted", eligibility_unverified: "Customer eligibility has not been verified",
  wrong_owner: "Account evidence does not match the signed-in account", account_not_ready: "Account access is not ready",
  stale_evidence: "Provider evidence must be refreshed", unavailable: "Provider data is temporarily unavailable",
  integration_unverified: "Live asset and balance access is disabled pending provider verification", invalid_request: "The data request is invalid",
};
export class ReadContractError extends Error {
  constructor(readonly code: ReadCode) { super(messages[code]); this.name = "ReadContractError"; }
}
