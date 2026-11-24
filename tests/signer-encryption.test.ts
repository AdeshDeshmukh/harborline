import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createEncryptedSigner, readSignerPublicKey } from "../src/features/accounts/key-store.server";
const accountId = "55555555-5555-4555-8555-555555555555";

test("P-256 signers round trip through account-bound AES-256-GCM without exposing private material", () => {
  const key = randomBytes(32), keys = new Map([[1, key]]);
  const first = createEncryptedSigner(accountId, key, 1), second = createEncryptedSigner(accountId, key, 1);
  expect(first.publicKey).toMatch(/^(02|03)[0-9a-f]{64}$/);
  expect(first.nonce).toHaveLength(12); expect(first.tag).toHaveLength(16);
  expect(first.nonce.equals(second.nonce)).toBe(false);
  expect(first.publicKey).not.toBe(second.publicKey);
  expect(readSignerPublicKey(accountId, first, keys)).toBe(first.publicKey);
  expect(Object.keys(first).sort()).toEqual(["encryptedKey", "encryptionKeyVersion", "nonce", "publicKey", "tag"]);
});

test("wrong account, key version, encryption key or modified ciphertext cannot recover a signer", () => {
  const key = randomBytes(32), keys = new Map([[1, key]]), record = createEncryptedSigner(accountId, key, 1);
  const corrupt = Buffer.from(record.encryptedKey); corrupt[0] ^= 1;
  for (const modified of [{ ...record, encryptedKey: corrupt }, { ...record, tag: randomBytes(16) },
    { ...record, nonce: randomBytes(12) }, { ...record, encryptionKeyVersion: 2 }]) {
    expect(() => readSignerPublicKey(accountId, modified, keys)).toThrow("Signer recovery requires review");
  }
  expect(() => readSignerPublicKey("66666666-6666-4666-8666-666666666666", record, keys)).toThrow("Signer recovery requires review");
  expect(() => readSignerPublicKey(accountId, record, new Map([[1, randomBytes(32)]]))).toThrow("Signer recovery requires review");
});

test("encryption requires an explicit 256-bit key and positive version, with safe errors", () => {
  for (const [key, version] of [[Buffer.alloc(16), 1], [randomBytes(32), 0], [randomBytes(32), 1.5]] as const) {
    expect(() => createEncryptedSigner(accountId, key, version)).toThrow("Signer configuration is invalid");
  }
});
