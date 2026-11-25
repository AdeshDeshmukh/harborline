import "server-only";
import { isUuid } from "../../server/env";
import { normalizeAssets, normalizeAvailability, normalizeCashBalance, restrictedCountries, validateRoute } from "./read-contracts";
import { ReadContractError, SOLANA_USDC_MINT, type ReadSource, type RouteIdentity } from "./read-types";

type Transport = { request: (method: "GET", path: string, options?: { userId?: string }) => Promise<unknown> };
export function createGatewayReadAdapter(transport: Transport, source: ReadSource, clock: () => Date = () => new Date()) {
  if (source !== "provider" && source !== "contract_fixture") throw new ReadContractError("invalid_request");
  function start() {
    const timestamp = clock();
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) throw new ReadContractError("invalid_request");
    return timestamp.toISOString();
  }
  async function read(path: string, userId?: string) {
    try { return await transport.request("GET", path, userId ? { userId } : undefined); }
    catch { throw new ReadContractError("unavailable"); }
  }
  return Object.freeze({
    source,
    async assets(rawRoute: RouteIdentity) {
      const route = validateRoute(rawRoute), observedAt = start();
      const [stock, cash, restrictions, availability] = await Promise.all([
        read(`/v1/gateway/assets/solana/${route.stockAddress}`), read(`/v1/gateway/assets/solana/${SOLANA_USDC_MINT}`),
        read("/v1/gateway/assets/restrictions"), read("/v1/gateway/assets/availability"),
      ]);
      return Object.freeze({ source, observedAt, assets: normalizeAssets({ data: [stock, cash] }, route),
        restrictedCountries: Object.freeze(restrictedCountries(restrictions)), backendAvailability: normalizeAvailability(availability) });
    },
    async balance(providerUserId: string, cashId: string) {
      if (!isUuid(providerUserId) || !isUuid(cashId)) throw new ReadContractError("invalid_request");
      const observedAt = start();
      return Object.freeze({ source, observedAt, balance: normalizeCashBalance(await read("/v1/gateway/balances", providerUserId), cashId) });
    },
  });
}
