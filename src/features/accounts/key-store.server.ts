import "server-only";
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, ECDH, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { isUuid } from "../../server/env";
import type { createSignerDatabase } from "../../server/db";
import type { OwnerContext } from "../identity/access.server";
import { eq } from "drizzle-orm";
import { signerSecrets } from "../../server/db/schema";

export type EncryptedSigner = { encryptedKey: Buffer; nonce: Buffer; tag: Buffer; encryptionKeyVersion: number };
export type SignerEnvelope = EncryptedSigner & { publicKey: string };
export class SignerError extends Error {
  constructor(readonly code: "configuration_error" | "recovery_required") {
    super(code === "configuration_error" ? "Signer configuration is invalid" : "Signer recovery requires review");
    this.name = "SignerError";
  }
}
export function createEncryptedSigner(accountId: string, key: Buffer, version: number): SignerEnvelope {
  if (!isUuid(accountId) || key.length !== 32 || !Number.isSafeInteger(version) || version < 1) throw new SignerError("configuration_error");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const plaintext = privateKey.export({ type: "pkcs8", format: "der" });
  try {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad(accountId, version));
    const encryptedKey = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { publicKey: publicHex(privateKey), encryptedKey, nonce, tag: cipher.getAuthTag(), encryptionKeyVersion: version };
  } finally { plaintext.fill(0); }
}
export function readSignerPublicKey(accountId: string, record: EncryptedSigner, keys: ReadonlyMap<number, Buffer>): string {
  let plaintext: Buffer | undefined;
  try {
    const key = keys.get(record.encryptionKeyVersion);
    if (!isUuid(accountId) || !key || key.length !== 32 || record.nonce.length !== 12 || record.tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, record.nonce);
    decipher.setAAD(aad(accountId, record.encryptionKeyVersion)); decipher.setAuthTag(record.tag);
    plaintext = Buffer.concat([decipher.update(record.encryptedKey), decipher.final()]);
    return publicHex(createPrivateKey({ key: plaintext, type: "pkcs8", format: "der" }));
  } catch { throw new SignerError("recovery_required"); }
  finally { plaintext?.fill(0); }
}

const aad = (accountId: string, version: number) => Buffer.from(`harborline-signer:v${version}:${accountId}`);
function publicHex(privateKey: KeyObject) {
  if (privateKey.type !== "private" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new SignerError("recovery_required");
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return ECDH.convertKey(point, "prime256v1", undefined, undefined, "compressed").toString("hex");
}

export function createSignerStore(database: ReturnType<typeof createSignerDatabase>, keys: ReadonlyMap<number, Buffer>, activeVersion: number) {
  if (!Number.isSafeInteger(activeVersion) || activeVersion < 1 || keys.get(activeVersion)?.length !== 32) throw new SignerError("configuration_error");
  const keyRing = new Map([...keys].map(([version, key]) => [version, Buffer.from(key)]));
  return { async resolve(context: OwnerContext, expectedPublicKey: string | null, allowCreate: boolean): Promise<string> {
    let publicKey: string | null;
    try {
      publicKey = await database.withOwner(context.ownerId, async tx => {
        let [record] = await tx.select().from(signerSecrets).where(eq(signerSecrets.accountId, context.accountId));
        if (!record) {
          if (!allowCreate || expectedPublicKey !== null) return null;
          const { publicKey: unused, ...encrypted } = createEncryptedSigner(context.accountId, keyRing.get(activeVersion)!, activeVersion);
          void unused;
          await tx.insert(signerSecrets).values({ accountId: context.accountId, ...encrypted })
            .onConflictDoNothing({ target: signerSecrets.accountId });
          [record] = await tx.select().from(signerSecrets).where(eq(signerSecrets.accountId, context.accountId));
        }
        if (!record) return null;
        try {
          const value = readSignerPublicKey(context.accountId, record, keyRing);
          return expectedPublicKey === null || value === expectedPublicKey ? value : null;
        } catch { return null; }
      });
    } catch { throw new SignerError("recovery_required"); }
    if (!publicKey) throw new SignerError("recovery_required");
    return publicKey;
  } };
}
