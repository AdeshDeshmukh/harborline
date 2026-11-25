import {createHash,createPublicKey,ECDH,verify} from "node:crypto";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createEncryptedSigner} from "../src/features/accounts/key-store.server";
import {stampEncryptedSigner} from "../src/features/accounts/signer.server";
const id="33333333-3333-4333-8333-333333333333",key=Buffer.alloc(32,7),keys=new Map([[1,key]]);
const payload=(text:string)=>({payload:text,digest:createHash("sha256").update(text).digest("hex")});
test("wallet stamps verify exact UTF8 bytes in order using DER P256 signatures",()=>{
  const record=createEncryptedSigner(id,key,1),items=[payload('{"amount":"1","memo":"海"}\n'),payload('{"amount":"2"}\n')];
  const stamps=stampEncryptedSigner(id,record,keys,record.publicKey,items);
  expect(stamps).toHaveLength(2);
  const point=ECDH.convertKey(Buffer.from(record.publicKey,"hex"),"prime256v1",undefined,undefined,"uncompressed") as Buffer;
  const publicKey=createPublicKey({format:"jwk",key:{kty:"EC",crv:"P-256",x:point.subarray(1,33).toString("base64url"),y:point.subarray(33).toString("base64url")}});
  stamps.forEach((stamp,i)=>{
    expect(stamp).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded=JSON.parse(Buffer.from(stamp,"base64url").toString());
    expect(Object.keys(decoded).sort()).toEqual(["publicKey","scheme","signature"]);
    expect(decoded).toMatchObject({publicKey:record.publicKey,scheme:"SIGNATURE_SCHEME_TK_API_P256"});
    const signature=Buffer.from(decoded.signature,"hex");expect(signature[0]).toBe(0x30);
    expect(verify("sha256",Buffer.from(items[i].payload),publicKey,signature)).toBe(true);
    expect(verify("sha256",Buffer.from(items[i].payload.trim()),publicKey,signature)).toBe(false);
    expect(verify("sha256",Buffer.from(items[i].digest,"hex"),publicKey,signature)).toBe(false);
  });
});
test.each(["owner","public_key","ciphertext","digest","missing_key"])("%s mismatch fails without a stamp",kind=>{
  const record=createEncryptedSigner(id,key,1),items=[payload("fixture\n")];
  if(kind==="ciphertext")record.tag[0]^=1;
  if(kind==="digest")items[0].digest="0".repeat(64);
  expect(()=>stampEncryptedSigner(kind==="owner"?"44444444-4444-4444-8444-444444444444":id,record,kind==="missing_key"?new Map():keys,kind==="public_key"?"02"+"0".repeat(64):record.publicKey,items)).toThrow();
});
