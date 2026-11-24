import "server-only";
import type { OwnerContext } from "../identity/access.server";
import type { Customer, createAccountsGateway } from "../../integrations/truemarkets/accounts.server";
import { AccountsContractError } from "../../integrations/truemarkets/accounts.server";

export type ProvisionResult = Readonly<{ status: "ready" | "pending" | "recovery_required" | "blocked"; accountId: string }>;
export type ProvisionSnapshot = { externalRefId: string; providerUserId: string | null };
export type ProviderOutcome = { status: "ready" | "pending" | "recovery_required"; customer?: Customer };
export type ProvisionRepository = {
  prepare(context: OwnerContext): Promise<{ status: "prepared"; publicKey: string } | ProvisionResult>;
  finish(context: OwnerContext, publicKey: string, action: (snapshot: ProvisionSnapshot) => Promise<ProviderOutcome>): Promise<ProvisionResult>;
};
export function createProvisioningService(repository: ProvisionRepository, gateway: ReturnType<typeof createAccountsGateway>) {
  return { async provision(context: OwnerContext): Promise<ProvisionResult> {
    try {
      const prepared = await repository.prepare(context);
      if (prepared.status !== "prepared") return prepared;
      return await repository.finish(context, prepared.publicKey, async snapshot => {
        try {
          const existing = await gateway.find(snapshot.externalRefId);
          if (existing && (snapshot.providerUserId && existing.providerUserId !== snapshot.providerUserId ||
            existing.walletAddresses.solana && existing.walletAddresses.evm)) return { status: "recovery_required" };
          const result = await gateway.create(snapshot.externalRefId, prepared.publicKey);
          if (existing && (existing.providerUserId !== result.customer.providerUserId ||
            (["solana", "evm"] as const).some(chain => existing.walletAddresses[chain] && result.customer.walletAddresses[chain] &&
              existing.walletAddresses[chain] !== result.customer.walletAddresses[chain]))) return { status: "recovery_required" };
          // Only a fresh 201 establishes use of the signer sent. A read or 200
          // cannot verify the registered key after an uncertain earlier attempt.
          if (result.status === 200) return { status: "recovery_required" };
          const complete = Boolean(result.customer.walletAddresses.solana && result.customer.walletAddresses.evm);
          return { status: complete ? "ready" : "pending", customer: result.customer };
        } catch (error) {
          return { status: error instanceof AccountsContractError ? "recovery_required" : "pending" };
        }
      });
    } catch {
      // The provider may have succeeded before a DB failure. Never treat an
      // exception as permission to reset the reference or generate another key.
      return { status: "pending", accountId: context.accountId };
    }
  } };
}
