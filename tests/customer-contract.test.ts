import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAccountsGateway, type AccountsTransport } from "../src/integrations/truemarkets/accounts.server";
const org = "22222222-2222-4222-8222-222222222222", userId = "33333333-3333-4333-8333-333333333333";
const publicKey = `02${"ab".repeat(32)}`;
const user = { user_id: userId, external_ref_id: "hl_synthetic", created_at: "2026-11-24T00:00:00Z",
  wallets: [{ chain_family: "solana", address: "11111111111111111111111111111111" }, { chain_family: "evm", address: `0x${"ab".repeat(20)}` }] };

test("customer creation preserves HTTP 201/200 and sends only stable reference and original public key", async () => {
  const transport = vi.fn<AccountsTransport>(async () => ({ status: 201, body: user }));
  const api = createAccountsGateway(org, transport);
  const result = await api.create(user.external_ref_id, publicKey);
  expect(result).toEqual({ status: 201, customer: { providerUserId: userId, externalRefId: user.external_ref_id,
    walletAddresses: { solana: user.wallets[0].address, evm: user.wallets[1].address } } });
  expect(transport).toHaveBeenCalledWith("POST", `/v1/account/organizations/${org}/users`, { external_ref_id: user.external_ref_id, signer_public_key: publicKey });
  transport.mockResolvedValue({ status: 200, body: user });
  expect((await api.create(user.external_ref_id, publicKey)).status).toBe(200);
});

test("lookup requires one unambiguous exact reference and does not select an arbitrary user", async () => {
  const transport = vi.fn<AccountsTransport>(async () => ({ status: 200, body: { data: [], pagination: { next_cursor: null } } }));
  const api = createAccountsGateway(org, transport);
  expect(await api.find(user.external_ref_id)).toBeNull();
  expect(transport).toHaveBeenCalledWith("GET", `/v1/account/organizations/${org}/users?external_ref_id=hl_synthetic`);
  for (const data of [[user, user], [{ ...user, external_ref_id: "wrong" }]]) {
    transport.mockResolvedValue({ status: 200, body: { data, pagination: { next_cursor: null } } });
    await expect(api.find(user.external_ref_id)).rejects.toThrow("Customer response could not be verified");
  }
});

test("malformed identities, duplicate chains and invalid addresses fail with a fixed error", async () => {
  const transport = vi.fn<AccountsTransport>(); const api = createAccountsGateway(org, transport);
  for (const body of [{ ...user, user_id: "private-bad-id" }, { ...user, external_ref_id: "wrong" },
    { ...user, wallets: [user.wallets[0], user.wallets[0]] }, { ...user, wallets: [{ chain_family: "evm", address: "private-invalid" }] }]) {
    transport.mockResolvedValue({ status: 201, body });
    await expect(api.create(user.external_ref_id, publicKey)).rejects.toThrow("Customer response could not be verified");
  }
});

test("empty wallets remain an incomplete customer, never fabricated addresses", async () => {
  const api = createAccountsGateway(org, async () => ({ status: 201, body: { ...user, wallets: [] } }));
  expect((await api.create(user.external_ref_id, publicKey)).customer.walletAddresses).toEqual({});
});

test("base58 text that does not decode to a 32-byte Solana address is rejected", async () => {
  const api = createAccountsGateway(org, async () => ({ status: 201, body: { ...user,
    wallets: [{ chain_family: "solana", address: "2".repeat(32) }] } }));
  await expect(api.create(user.external_ref_id, publicKey)).rejects.toThrow("Customer response could not be verified");
});
