import "server-only";
import {createDecipheriv,createPrivateKey,sign} from "node:crypto";
import {eq} from "drizzle-orm";
import {readSignerPublicKey,SignerError,type EncryptedSigner} from "./key-store.server";
import type {createSignerDatabase} from "../../server/db";
import {signerSecrets} from "../../server/db/schema";
import type {OwnerContext} from "../identity/access.server";
import {validateUnsignedPayloads} from "../../integrations/truemarkets/preparation.server";
import type { Payload } from "../orders/review-types";
/** Internal signing primitive; callers supply only server-loaded approved payloads. */
export function stampEncryptedSigner(accountId:string,record:EncryptedSigner,keys:ReadonlyMap<number,Buffer>,expectedPublicKey:string,payloads:readonly Payload[]):readonly string[]{
  let plaintext:Buffer|undefined;
  try{
    const checked=validateUnsignedPayloads(payloads);
    if(readSignerPublicKey(accountId,record,keys)!==expectedPublicKey)throw new Error();
    const decipher=createDecipheriv("aes-256-gcm",keys.get(record.encryptionKeyVersion)!,record.nonce);
    decipher.setAAD(Buffer.from(`harborline-signer:v${record.encryptionKeyVersion}:${accountId}`));decipher.setAuthTag(record.tag);
    plaintext=Buffer.concat([decipher.update(record.encryptedKey),decipher.final()]);
    const privateKey=createPrivateKey({key:plaintext,type:"pkcs8",format:"der"});
    return Object.freeze(checked.map(item=>Buffer.from(JSON.stringify({publicKey:expectedPublicKey,signature:sign("sha256",Buffer.from(item.payload,"utf8"),{key:privateKey,dsaEncoding:"der"}).toString("hex"),scheme:"SIGNATURE_SCHEME_TK_API_P256"})).toString("base64url")));
  }catch{throw new SignerError("recovery_required");}finally{plaintext?.fill(0);}
}
export function createOwnedSigner(database:ReturnType<typeof createSignerDatabase>,keys:ReadonlyMap<number,Buffer>){
  const ring=new Map([...keys].map(([version,key])=>[version,Buffer.from(key)]));
  return {async stamp(context:OwnerContext,expectedPublicKey:string,payloads:readonly Payload[]):Promise<readonly string[]>{
    const captured=validateUnsignedPayloads(payloads);
    try{return await database.withOwner(context.ownerId,async tx=>{
      const [record]=await tx.select().from(signerSecrets).where(eq(signerSecrets.accountId,context.accountId));
      if(!record)throw new SignerError("recovery_required");
      return stampEncryptedSigner(context.accountId,record,ring,expectedPublicKey,captured);
    });}catch{throw new SignerError("recovery_required");}
  }};
}
