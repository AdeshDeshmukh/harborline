import "server-only";
import { isSolanaAddress } from "./solana-address";
import { isUuid } from "../../server/env";
export type Customer = Readonly<{ providerUserId: string; externalRefId: string; walletAddresses: { solana?: string; evm?: string } }>;
export type AccountsTransport = (method: "GET" | "POST", path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
export class AccountsContractError extends Error {
  constructor() { super("Customer response could not be verified"); this.name = "AccountsContractError"; }
}
export function createAccountsGateway(organizationId: string, transport: AccountsTransport) {
  if (!isUuid(organizationId)) throw new AccountsContractError();
  const path = `/v1/account/organizations/${organizationId}/users`;
  return {
    async find(externalRefId: string): Promise<Customer | null> {
      reference(externalRefId);
      const result = await transport("GET", `${path}?external_ref_id=${encodeURIComponent(externalRefId)}`);
      const page = object(result.body), pagination = object(page.pagination);
      if (result.status !== 200 || !Array.isArray(page.data) || page.data.length > 1 || pagination.next_cursor !== null) throw new AccountsContractError();
      return page.data.length ? customer(page.data[0], externalRefId) : null;
    },
    async create(externalRefId: string, publicKey: string): Promise<{ status: 200 | 201; customer: Customer }> {
      reference(externalRefId);
      if (!/^(02|03)[0-9a-fA-F]{64}$/.test(publicKey)) throw new AccountsContractError();
      const result = await transport("POST", path, { external_ref_id: externalRefId, signer_public_key: publicKey });
      if (result.status !== 200 && result.status !== 201) throw new AccountsContractError();
      return { status: result.status, customer: customer(result.body, externalRefId) };
    },
  };
}

function reference(value: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new AccountsContractError();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountsContractError();
  return value as Record<string, unknown>;
}
function customer(value: unknown, expectedReference: string): Customer {
  const row = object(value);
  if (!isUuid(row.user_id) || row.external_ref_id !== expectedReference ||
    typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) ||
    !Array.isArray(row.wallets) || row.wallets.length > 2) throw new AccountsContractError();
  const walletAddresses: Customer["walletAddresses"] = {};
  for (const value of row.wallets) {
    const wallet = object(value), chain = wallet.chain_family;
    if ((chain !== "solana" && chain !== "evm") || walletAddresses[chain] !== undefined || typeof wallet.address !== "string" ||
      !(chain === "evm" ? /^0x[0-9a-fA-F]{40}$/.test(wallet.address) : isSolanaAddress(wallet.address))) throw new AccountsContractError();
    walletAddresses[chain] = wallet.address;
  }
  return Object.freeze({ providerUserId: row.user_id, externalRefId: expectedReference, walletAddresses: Object.freeze(walletAddresses) });
}
