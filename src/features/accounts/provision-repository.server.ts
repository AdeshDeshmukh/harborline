import "server-only";
import type { createDatabase } from "../../server/db";
import type { createSignerStore } from "./key-store.server";
import type { ProvisionRepository } from "./provision.server";
import type { ProvisionResult } from "./provision.server";
import type { OwnerContext } from "../identity/access.server";
import { and, eq, sql } from "drizzle-orm";
import { gatewayAccounts, profiles } from "../../server/db/schema";

type Transaction = Parameters<Parameters<ReturnType<typeof createDatabase>["withOwner"]>[1]>[0];
const result = (context: OwnerContext, status: ProvisionResult["status"]): ProvisionResult => ({ status, accountId: context.accountId });

async function lockedAccount(tx: Transaction, context: OwnerContext) {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  const [row] = await tx.select({ account: gatewayAccounts, profile: profiles }).from(gatewayAccounts)
    .innerJoin(profiles, eq(profiles.authUserId, gatewayAccounts.ownerId))
    .where(and(eq(gatewayAccounts.id, context.accountId), eq(gatewayAccounts.ownerId, context.ownerId)))
    .for("no key update");
  if (!row || row.account.externalRefId !== context.externalRefId || !row.profile.pilotEnabled ||
    row.profile.eligibilityStatus !== "ELIGIBLE" || row.account.activeOperationId !== null) return null;
  return row.account;
}

export function createProvisioningRepository(database: ReturnType<typeof createDatabase>, signers: ReturnType<typeof createSignerStore>): ProvisionRepository {
  return {
    async prepare(context) {
      return database.withOwner<Awaited<ReturnType<ProvisionRepository["prepare"]>>>(context.ownerId, async tx => {
        const account = await lockedAccount(tx, context);
        if (!account) return result(context, "blocked");
        let publicKey: string;
        try {
          publicKey = await signers.resolve(context, account.publicKey,
            account.provisioningState === "UNPROVISIONED" && account.publicKey === null && account.providerUserId === null);
        } catch { return result(context, "recovery_required"); }
        if (account.provisioningState === "READY") return result(context, "ready");
        await tx.update(gatewayAccounts).set({ publicKey, provisioningState: "PROVISIONING" }).where(eq(gatewayAccounts.id, account.id));
        return { status: "prepared", publicKey };
      });
    },
    async finish(context, publicKey, action) {
      return database.withOwner(context.ownerId, async tx => {
        const account = await lockedAccount(tx, context);
        if (!account) return result(context, "blocked");
        if (account.publicKey !== publicKey) return result(context, "recovery_required");
        try { await signers.resolve(context, publicKey, false); }
        catch { return result(context, "recovery_required"); }
        if (account.provisioningState === "READY") return result(context, "ready");
        const outcome = await action({ externalRefId: account.externalRefId, providerUserId: account.providerUserId });
        const customer = outcome.customer;
        if (!customer) return result(context, outcome.status === "ready" ? "recovery_required" : outcome.status);
        if (customer.externalRefId !== account.externalRefId || account.providerUserId && account.providerUserId !== customer.providerUserId ||
          ["solana", "evm"].some(chain => {
            const key = chain as "solana" | "evm";
            return account.walletAddresses[key] && customer.walletAddresses[key] && account.walletAddresses[key] !== customer.walletAddresses[key];
          })) return result(context, "recovery_required");
        const wallets = { ...account.walletAddresses, ...customer.walletAddresses };
        if (outcome.status === "ready" && (!wallets.solana || !wallets.evm)) return result(context, "recovery_required");
        await tx.update(gatewayAccounts).set({ providerUserId: customer.providerUserId, walletAddresses: wallets,
          provisioningState: outcome.status === "ready" ? "READY" : "PROVISIONING" }).where(eq(gatewayAccounts.id, account.id));
        return result(context, outcome.status);
      });
    },
  };
}
