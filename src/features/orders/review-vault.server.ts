import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isUuid } from "../../server/env";
import { validateUnsignedPayloads } from "../../integrations/truemarkets/preparation.server";
import { ReviewError, type Payload, type ReviewBinding, type SealedPayloads } from "./review-types";
import {normalizeSaleVaultBinding} from "./disposal-terms.server";
import type {SaleVaultBinding} from "./disposal-store-types";
export type VaultBinding=ReviewBinding|SaleVaultBinding;
export function createReviewVault(key: Buffer, version: number) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Number.isSafeInteger(version) || version < 1) throw new ReviewError("unavailable");
  const secret = Buffer.from(key);
  function aad(binding: VaultBinding, hash: string) {
    if("operationKind" in binding){
      const sale=normalizeSaleVaultBinding(binding);
      if(!/^[0-9a-f]{64}$/.test(hash))throw new ReviewError("invalid_terms");
      return Buffer.from(JSON.stringify(["harborline-sale-review-payloads-v2",version,sale,hash]));
    }
    if (![binding.accountId,binding.intentId,binding.calculationId].every(isUuid) || ![binding.generation,binding.policyRevision].every(n=>Number.isSafeInteger(n)&&n>0) || !/^[0-9a-f]{64}$/.test(hash)) throw new ReviewError("invalid_terms");
    return Buffer.from(JSON.stringify(["harborline-review-payloads",version,binding.accountId,binding.intentId,binding.generation,binding.policyRevision,binding.calculationId,hash]));
  }
  return {
    seal(binding: VaultBinding, hash: string, payloads: readonly Payload[]): SealedPayloads {
      const plaintext = Buffer.from(JSON.stringify(validateUnsignedPayloads(payloads)));
      try {
        const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm",secret,nonce);
        cipher.setAAD(aad(binding,hash));
        return {ciphertext:Buffer.concat([cipher.update(plaintext),cipher.final()]),nonce,tag:cipher.getAuthTag(),keyVersion:version};
      } finally { plaintext.fill(0); }
    },
    open(binding: VaultBinding, hash: string, sealed: SealedPayloads): readonly Payload[] {
      let plaintext: Buffer | undefined;
      try {
        if (sealed.keyVersion !== version || sealed.nonce.length !== 12 || sealed.tag.length !== 16 || sealed.ciphertext.length > 2200000) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm",secret,sealed.nonce);
        decipher.setAAD(aad(binding,hash)); decipher.setAuthTag(sealed.tag);
        plaintext = Buffer.concat([decipher.update(sealed.ciphertext),decipher.final()]);
        return validateUnsignedPayloads(JSON.parse(plaintext.toString("utf8")));
      } catch { throw new ReviewError("unavailable"); }
      finally { plaintext?.fill(0); }
    },
  };
}
