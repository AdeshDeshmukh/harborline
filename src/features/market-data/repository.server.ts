import "server-only";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "../../server/db";
import { gatewayAccounts, profiles } from "../../server/db/schema";
import type { OwnerContext } from "../identity/access.server";
import { ReadContractError } from "../../integrations/truemarkets/read-types";
import type { MarketAccount } from "./service.server";

export function createMarketAccountReader(database = getDatabase()) {
  return async (context: OwnerContext): Promise<MarketAccount> => {
    const account = await database.withOwner(context.ownerId, async tx => {
      const [row] = await tx.select({ accountId: gatewayAccounts.id, ownerId: gatewayAccounts.ownerId,
        externalRefId: gatewayAccounts.externalRefId, providerUserId: gatewayAccounts.providerUserId,
        provisioningState: gatewayAccounts.provisioningState, activeOperationId: gatewayAccounts.activeOperationId,
        walletAddresses: gatewayAccounts.walletAddresses, pilotEnabled: profiles.pilotEnabled,
        eligibilityStatus: profiles.eligibilityStatus, eligibilityCheckedAt: profiles.eligibilityCheckedAt, timezone: profiles.timezone,
      }).from(gatewayAccounts).innerJoin(profiles, eq(profiles.authUserId, gatewayAccounts.ownerId))
        .where(and(eq(gatewayAccounts.id, context.accountId), eq(gatewayAccounts.ownerId, context.ownerId)));
      return row;
    });
    if (!account || account.externalRefId !== context.externalRefId) throw new ReadContractError("wrong_owner");
    const { walletAddresses, eligibilityCheckedAt, ...fields } = account;
    return Object.freeze({ ...fields, eligibilityCheckedAt: eligibilityCheckedAt?.toISOString() ?? null, solanaAddress: walletAddresses.solana ?? null });
  };
}
