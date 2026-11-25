import "server-only";
import type { OwnerContext } from "../identity/access.server";
import { isAssignedCountryCode } from "../../integrations/truemarkets/country-codes";
import { isUuid } from "../../server/env";
import type { createGatewayReadAdapter } from "../../integrations/truemarkets/reads.server";
import { object, validateRoute } from "../../integrations/truemarkets/read-contracts";
import { isSolanaAddress } from "../../integrations/truemarkets/solana-address";
import { ReadContractError, SOLANA_USDC_MINT, type RouteIdentity } from "../../integrations/truemarkets/read-types";
import { calculateAllowance } from "../planning/calculate-allowance";
import { localDateAt, validateTimezone } from "../planning/validation";
import type { PlanView } from "../planning/storage-types";

export type MarketAccount = Readonly<{ ownerId: string; accountId: string; externalRefId: string; providerUserId: string | null;
  provisioningState: string; pilotEnabled: boolean; eligibilityStatus: string; eligibilityCheckedAt: string | null;
  activeOperationId: string | null; solanaAddress: string | null; timezone: string }>;
type Options = { route: RouteIdentity; adapter: ReturnType<typeof createGatewayReadAdapter>; account: (context: OwnerContext) => Promise<MarketAccount>;
  eligibility: (context: OwnerContext) => Promise<unknown>; planning?: (context: OwnerContext) => Promise<PlanView>; clock?: () => Date };
function checkedTime(value: unknown) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ReadContractError("eligibility_unverified");
  return Date.parse(value);
}
function reference(value: unknown) { return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }

// Explicitly injected, never composed with live credentials in HL-18's gated slice.
export function createMarketReadService(options: Options) {
  const route = validateRoute(options.route), adapter = options.adapter, clock = options.clock ?? (() => new Date());
  function now() { const date = clock(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new ReadContractError("unavailable"); return new Date(date); }
  function fresh(observedAt: string) {
    const age = now().getTime() - Date.parse(observedAt);
    if (!Number.isFinite(age) || age < 0 || age > 15000) throw new ReadContractError("stale_evidence");
  }
  async function access(context: OwnerContext) {
    const account = Object.freeze({ ...await options.account(context) });
    if (account.ownerId !== context.ownerId || account.accountId !== context.accountId || account.externalRefId !== context.externalRefId) throw new ReadContractError("wrong_owner");
    if (!isUuid(account.providerUserId) || account.provisioningState !== "READY" || !account.pilotEnabled || account.activeOperationId !== null) throw new ReadContractError("account_not_ready");
    if (account.eligibilityStatus !== "ELIGIBLE" || !account.eligibilityCheckedAt) throw new ReadContractError("eligibility_unverified");
    const proof = structuredClone(object(await options.eligibility(context))), timestamp = now().getTime();
    if (proof.ownerId !== account.ownerId || proof.accountId !== account.accountId || proof.providerUserId !== account.providerUserId ||
      proof.stockId !== route.stockId || proof.quoteAssetId !== route.cashId || proof.endUserApproved !== true || proof.backendMethodVerified !== true || proof.quoteAssetVerified !== true ||
      proof.source !== (adapter.source === "contract_fixture" ? "contract_fixture" : "provider_guidance") ||
      !reference(proof.guidanceRef) || !reference(proof.backendMethodRef) || !isAssignedCountryCode(proof.country) || !isAssignedCountryCode(proof.backendCountry) ||
      checkedTime(proof.checkedAt) > timestamp || checkedTime(proof.expiresAt) <= timestamp ||
      checkedTime(account.eligibilityCheckedAt) > checkedTime(proof.checkedAt)) throw new ReadContractError("eligibility_unverified");
    return { account: Object.freeze({ ...account }), proof: Object.freeze(proof), providerUserId: account.providerUserId };
  }
  async function supported(context: OwnerContext) {
    const authorized = await access(context), observed = await adapter.assets(route);
    fresh(observed.observedAt);
    if (observed.backendAvailability.country !== authorized.proof.backendCountry ||
      !observed.backendAvailability.productTypes.includes("spot") || !observed.backendAvailability.assetClasses.includes("stock") ||
      observed.restrictedCountries.includes(authorized.proof.country as string) || observed.restrictedCountries.includes(observed.backendAvailability.country)) throw new ReadContractError("restricted");
    if (checkedTime(authorized.proof.expiresAt) <= now().getTime()) throw new ReadContractError("eligibility_unverified");
    return { ...authorized, observed };
  }
  async function readBalance(context: OwnerContext) {
    const basis = await supported(context), observed = await adapter.balance(basis.providerUserId, route.cashId);
    validateFinalBasis(basis, observed.observedAt);
    return { basis, observed };
  }
  function validateFinalBasis(basis: Awaited<ReturnType<typeof supported>>, balanceObservedAt: string) {
    fresh(basis.observed.observedAt); fresh(balanceObservedAt);
    if (checkedTime(basis.proof.expiresAt) <= now().getTime()) throw new ReadContractError("eligibility_unverified");
  }
  async function balance(context: OwnerContext) {
    const { basis, observed } = await readBalance(context);
    const address = basis.account.solanaAddress;
    const funding = basis.proof.recoveryAndExitVerified === true && address && isSolanaAddress(address)
      ? Object.freeze({ network: "solana" as const, assetId: route.cashId, tokenAddress: SOLANA_USDC_MINT, decimals: 6, walletAddress: address, depositEnabled: false as const }) : null;
    return Object.freeze({ source: observed.source, observedAt: observed.observedAt, canAuthorize: false as const,
      balance: observed.balance, funding, planningDate: localDateAt(now(), validateTimezone(basis.account.timezone)), policyTimezone: basis.account.timezone });
  }
  return Object.freeze({
    async assets(context: OwnerContext) {
      const basis = await supported(context);
      return Object.freeze({ source: basis.observed.source, observedAt: basis.observed.observedAt, assets: basis.observed.assets,
        backendCountry: basis.observed.backendAvailability.country, canAuthorize: false as const });
    },
    balance,
    async allowance(context: OwnerContext) {
      const { basis, observed } = await readBalance(context);
      if (!options.planning) throw new ReadContractError("integration_unverified");
      const plan = await options.planning(context);
      if (!plan.policy || plan.policy.revision !== plan.revision) throw new ReadContractError("invalid_request");
      validateFinalBasis(basis, observed.observedAt);
      const asOfLocalDate = localDateAt(now(), validateTimezone(basis.account.timezone));
      const calculation = calculateAllowance({ available: observed.balance.available, commitments: plan.commitments,
        additionalBuffer: plan.policy.additionalBuffer, asOfLocalDate, horizonDays: plan.policy.horizonDays, policyRevision: plan.revision });
      return Object.freeze({ source: observed.source, observedAt: observed.observedAt, canAuthorize: false as const, asOfLocalDate, calculation, policyRevision: plan.revision });
    },
  });
}
