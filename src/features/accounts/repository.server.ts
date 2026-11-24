import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { VerifiedIdentity } from "../identity/types";
import { DatabaseError, getDatabase } from "../../server/db";
import { gatewayAccounts, profiles } from "../../server/db/schema";

export type OwnedAccount = Readonly<{
  accountId: string;
  ownerId: string;
  externalRefId: string;
  providerUserId: string | null;
  provisioningState: "UNPROVISIONED" | "PROVISIONING" | "READY" | "FAILED";
  pilotEnabled: boolean;
  eligibilityStatus: "UNKNOWN" | "ELIGIBLE" | "INELIGIBLE";
  timezone: string;
}>;

export async function bootstrapAccount(identity: VerifiedIdentity, database = getDatabase()): Promise<OwnedAccount> {
  return database.withOwner(identity.id, async tx => {
    // Name only the permitted column: ORM-generated DEFAULT columns would
    // require INSERT privileges on protected eligibility/pilot fields too.
    await tx.execute(sql`INSERT INTO harborline.profiles (auth_user_id)
      VALUES (${identity.id}) ON CONFLICT (auth_user_id) DO NOTHING`);
    await tx.insert(gatewayAccounts).values({ ownerId: identity.id, externalRefId: `hl_${randomUUID()}` })
      .onConflictDoNothing({ target: gatewayAccounts.ownerId });
    // A separate READ COMMITTED statement sees a concurrent winner after its
    // unique-key lock is released; a one-statement CTE could miss that row.
    const [account] = await tx.select({
      accountId: gatewayAccounts.id, ownerId: gatewayAccounts.ownerId,
      externalRefId: gatewayAccounts.externalRefId, providerUserId: gatewayAccounts.providerUserId,
      provisioningState: gatewayAccounts.provisioningState, pilotEnabled: profiles.pilotEnabled,
      eligibilityStatus: profiles.eligibilityStatus, timezone: profiles.timezone,
    }).from(gatewayAccounts).innerJoin(profiles, eq(profiles.authUserId, gatewayAccounts.ownerId))
      .where(eq(gatewayAccounts.ownerId, identity.id)).limit(1);
    if (!account) throw new DatabaseError("operation_failed");
    return Object.freeze(account);
  });
}
