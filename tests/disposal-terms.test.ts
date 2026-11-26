import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {buildStoredSaleTerms,hashStoredSaleTerms} from "../src/features/orders/disposal-terms.server";
import {buildDisposalReview} from "../src/features/orders/disposal-review";
import {createReviewVault} from "../src/features/orders/review-vault.server";
import {binding,request,holding,quote,at} from "./fixtures/disposal";
import {createCipheriv,createHash} from "node:crypto";
const readId="77777777-7777-4777-8777-777777777777";
function terms(){return buildStoredSaleTerms(buildDisposalReview(binding,request,holding,quote,at()),readId);}
test("sale review hash binds its normalized economic terms and original owned holding read",()=>{
 const value=terms(),hash=hashStoredSaleTerms(value);expect(value).toMatchObject({version:2,operationKind:"sell",binding:{holdingReadId:readId}});expect(hash).toMatch(/^[a-f0-9]{64}$/);
 expect(hashStoredSaleTerms(JSON.parse(JSON.stringify(value)))).toBe(hash);
 expect(hashStoredSaleTerms({...value,binding:{...value.binding,holdingReadId:binding.intentId}})).not.toBe(hash);
 expect(()=>hashStoredSaleTerms({...value,review:{...value.review,expectedNetQuote:"1000"}})).toThrow();
});
test("sale payloads use a distinct versioned vault binding and retain exact UTF-8 text",()=>{
 const value=terms(),vault=createReviewVault(Buffer.alloc(32,7),1),hash=hashStoredSaleTerms(value),payload="fictional sale\n",payloads=[{payload,digest:createHash("sha256").update(payload).digest("hex")}];
 const sealed=vault.seal(value.binding,hash,payloads);expect(vault.open(value.binding,hash,sealed)).toEqual(payloads);
 expect(()=>vault.open({...value.binding,holdingReadId:binding.intentId},hash,sealed)).toThrow();
 expect(()=>vault.open({accountId:binding.accountId,intentId:binding.intentId,generation:1,policyRevision:2,calculationId:readId},hash,sealed)).toThrow();
});
test("legacy buy binding and ciphertext still round-trip without a sale context",()=>{
 const vault=createReviewVault(Buffer.alloc(32,7),1),hash="a".repeat(64),b={accountId:binding.accountId,intentId:binding.intentId,generation:1,policyRevision:2,calculationId:readId},payload="fictional buy",payloads=[{payload,digest:createHash("sha256").update(payload).digest("hex")}];
 const sealed=vault.seal(b,hash,payloads);expect(vault.open(b,hash,sealed)).toEqual(payloads);
});

test("pre-sale buy ciphertext opens with the pinned legacy AAD byte sequence",()=>{
 const key=Buffer.alloc(32,7),nonce=Buffer.alloc(12,3),hash="b".repeat(64),b={accountId:binding.accountId,intentId:binding.intentId,generation:1,policyRevision:2,calculationId:readId},payload="pre-migration buy",payloads=[{payload,digest:createHash("sha256").update(payload).digest("hex")}];
 const oldAad=Buffer.from(JSON.stringify(["harborline-review-payloads",1,b.accountId,b.intentId,1,2,readId,hash])),cipher=createCipheriv("aes-256-gcm",key,nonce);cipher.setAAD(oldAad);
 const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payloads))),cipher.final()]);
 expect(createReviewVault(key,1).open(b,hash,{ciphertext,nonce,tag:cipher.getAuthTag(),keyVersion:1})).toEqual(payloads);
});
