import Decimal from "decimal.js";
import {expect,test} from "vitest";
import {buildDisposalReview} from "../src/features/orders/disposal-review";
import {reconcileDisposalFixture} from "../src/features/orders/disposal-settlement";
import {DisposalError} from "../src/features/orders/disposal-types";
import {binding,request,holding,quote,at,actual,proof,cash} from "./fixtures/disposal";
const review=()=>buildDisposalReview(binding,request,holding,quote,at());
test("complete sale reconciles stock debit and fee-net cash credit independently",()=>{
 expect(reconcileDisposalFixture(review(),actual(),proof(),at(1000))).toMatchObject({kind:"reconciled_fixture",actualBaseDebit:"0.5",actualGrossQuote:"100",actualFeeQuote:"0.5",actualNetQuoteCredit:"99.5",stockTotalBefore:"1",stockTotalAfter:"0.5",cashBefore:"2000",cashAfter:"2099.5",partial:false,canRelease:false,canExecute:false});
});
test.each(["failed","canceled"])("partial %s can have proceeds below the full-fill minimum",status=>{
 const observation={...actual(),status,filledBase:"0.2",remainingBase:"0.3",grossQuote:"40",feeQuote:"0.2"};
 const p={...proof(),cashAfter:cash("2039.8",1000),stockAfter:{...proof().stockAfter,available:"0.8",total:"0.8"}};
 expect(reconcileDisposalFixture(review(),observation,p,at(1000))).toMatchObject({status,partial:true,actualNetQuoteCredit:"39.8",stockTotalAfter:"0.8"});
});
test("zero-fill failed sale requires recorded zero gross and zero fee",()=>{
 const observation={...actual(),status:"failed",filledBase:"0",remainingBase:"0.5",grossQuote:"0",feeQuote:"0",averagePriceQuote:null},p={...proof(),cashAfter:cash("2000",1000),stockAfter:{...holding,observedAt:at(1000).toISOString()}};
 expect(reconcileDisposalFixture(review(),observation,p,at(1000))).toMatchObject({partial:false,actualNetQuoteCredit:"0"});
 expect(()=>reconcileDisposalFixture(review(),{...observation,feeQuote:"0.1"},p,at(1000))).toThrow(DisposalError);
});
test.each(["filledBase","remainingBase","grossQuote","feeQuote"])("missing actual %s remains unverified instead of using a quote",field=>{
 expect(()=>reconcileDisposalFixture(review(),{...actual(),[field]:null},proof(),at(1000))).toThrow(DisposalError);
});
test("independent recorded gross permits unknown VWAP, but known VWAP must reconcile",()=>{
 expect(reconcileDisposalFixture(review(),{...actual(),averagePriceQuote:null},proof(),at(1000)).actualGrossQuote).toBe("100");
 expect(()=>reconcileDisposalFixture(review(),{...actual(),averagePriceQuote:"199"},proof(),at(1000))).toThrow(DisposalError);
});
test("other movements explain both assets without being attributed to the sale",()=>{
 const p={...proof(),otherBaseCredits:"0.1",otherBaseDebits:"0.05",otherQuoteCredits:"2",otherQuoteDebits:"1",cashAfter:cash("2100.5",1000),stockAfter:{...proof().stockAfter,available:"0.55",total:"0.55"}};
 expect(reconcileDisposalFixture(review(),actual(),p,at(1000))).toMatchObject({actualNetQuoteCredit:"99.5",stockTotalAfter:"0.55",cashAfter:"2100.5",otherBaseCredits:"0.1",otherQuoteDebits:"1"});
});
test("base conservation uses total ownership instead of subtracting held units twice",()=>{
 const r=buildDisposalReview(binding,request,{...holding,available:"0.5",held:"0.5",total:"1"},quote,at());
 expect(reconcileDisposalFixture(r,actual(),proof(),at(1000)).stockTotalAfter).toBe("0.5");
});
test.each([{status:"pending"},{source:"provider"},{providerOrderId:"other-order"},{filledBase:"0.6",remainingBase:"0"},{filledBase:"0.4",remainingBase:"0.1"},{feeQuote:"1.1"},{grossQuote:"97",averagePriceQuote:"194"},{grossQuote:"100.0000001"},{filledBase:"0.500000001"},{remainingBase:null},{observedAt:at(-1).toISOString()},{observedAt:at(1001).toISOString()},{payloads:["private"]}])("invalid actuals cannot establish settlement: %j",change=>{
 expect(()=>reconcileDisposalFixture(review(),{...actual(),...change},proof(),at(1000))).toThrow(DisposalError);
});
test.each(["ownerId","accountId","providerUserId","intentId","assetId","cashId"])("observation and proof cannot change bound %s",field=>{
 const changedBinding={...binding,[field]:"99999999-9999-4999-8999-999999999999"};
 expect(()=>reconcileDisposalFixture(review(),{...actual(),binding:changedBinding},proof(),at(1000))).toThrow(DisposalError);
 expect(()=>reconcileDisposalFixture(review(),actual(),{...proof(),binding:changedBinding},at(1000))).toThrow(DisposalError);
});
test.each([
 {cashAfter:cash("2099.6",1000)},
 {cashAfter:{...cash("2099.5",1000),assetId:binding.assetId}},
 {cashAfter:{...cash("2099.5",1000),held:"1",total:"2100.5"}},
 {stockAfter:{...proof().stockAfter,available:"0.6",total:"0.6"}},
 {stockAfter:{...proof().stockAfter,available:"0.4",held:"0.1",total:"0.5"}},
 {cashBefore:cash("2000",1)},
 {cashBefore:cash("2000",-15001)},
 {cashAfter:cash("2099.5",999)},
 {stockAfter:{...proof().stockAfter,observedAt:at(1001).toISOString()}},
 {source:"provider"},{otherBaseDebits:"2"},{otherQuoteDebits:"3000"},{otherBaseCredits:"0.000000001"},{otherQuoteCredits:"1e-2"},{private_key:"marker"},
])("bad conservation/identity/chronology cannot be cleared: %j",change=>{
 expect(()=>reconcileDisposalFixture(review(),actual(),{...proof(),...change},at(1000))).toThrow(DisposalError);
});
test("post-balance evidence must be fresh when the fixture is reconciled",()=>{
 expect(()=>reconcileDisposalFixture(review(),actual(),proof(),at(16001))).toThrow(DisposalError);
});
test("exact arithmetic is isolated from global Decimal configuration",()=>{
 const precision=Decimal.precision,rounding=Decimal.rounding;
 try {Decimal.set({precision:2,rounding:Decimal.ROUND_UP});expect(reconcileDisposalFixture(review(),actual(),proof(),at(1000)).actualNetQuoteCredit).toBe("99.5");}
 finally {Decimal.set({precision,rounding});}
});
test("zero starting quote cash does not prevent a fixture sale credit",()=>{
 const p={...proof(),cashBefore:cash("0"),cashAfter:cash("99.5",1000)};
 expect(reconcileDisposalFixture(review(),actual(),p,at(1000)).actualNetQuoteCredit).toBe("99.5");
});
test("a late final outcome can reconcile after review expiry without authorizing a new sale",()=>{
 const p={...proof(),cashAfter:cash("2099.5",60000),stockAfter:{...proof().stockAfter,observedAt:at(60000).toISOString()}};
 expect(reconcileDisposalFixture(review(),{...actual(),observedAt:at(60000).toISOString()},p,at(60000))).toMatchObject({actualNetQuoteCredit:"99.5",canRelease:false});
});
test.each(["failed","canceled"])("a full fill cannot evade the fixture proceeds floor by reporting %s",status=>{
 const p={...proof(),cashAfter:cash("2096.5",1000)};
 expect(()=>reconcileDisposalFixture(review(),{...actual(),status,grossQuote:"97",averagePriceQuote:"194"},p,at(1000))).toThrow(DisposalError);
});

test("quote balance at the atomic maximum reconciles, but one above it cannot",()=>{
 const p={...proof(),cashBefore:cash("18446744073610.051615"),cashAfter:cash("18446744073709.551615",1000)};
 expect(reconcileDisposalFixture(review(),actual(),p,at(1000)).cashAfter).toBe("18446744073709.551615");
 expect(()=>reconcileDisposalFixture(review(),actual(),{...proof(),cashBefore:cash("18446744073709.551616"),cashAfter:cash("18446744073809.051616",1000)},at(1000))).toThrow(DisposalError);
});
test("cumulative unrelated quote movements are not single transfer amounts",()=>{
 const p={...proof(),otherQuoteCredits:"18446744073709.551616",otherQuoteDebits:"18446744073709.551616"};
 expect(reconcileDisposalFixture(review(),actual(),p,at(1000)).cashAfter).toBe("2099.5");
});
test("known zero-fill VWAP limit cannot become a reported execution price or cash effect",()=>{
 const observation={...actual(),status:"failed",filledBase:"0",remainingBase:"0.5",grossQuote:"0",feeQuote:"0",averagePriceQuote:"200"};
 const p={...proof(),cashAfter:cash("2000",1000),stockAfter:{...holding,observedAt:at(1000).toISOString()}};
 const result=reconcileDisposalFixture(review(),observation,p,at(1000));expect(result.actualNetQuoteCredit).toBe("0");expect(result).not.toHaveProperty("averagePriceQuote");
});
test("an explicitly bound approval baseline may follow review creation",()=>{
 const r=review(),approvedHolding={...holding,observedAt:at(1000).toISOString()},approvedCash=cash("2000",1000),observation={...actual(),observedAt:at(2000).toISOString()},p={...proof(),cashBefore:approvedCash,cashAfter:cash("2099.5",2000),stockAfter:{...proof().stockAfter,observedAt:at(2000).toISOString()}};
 expect(reconcileDisposalFixture(r,observation,p,at(2000),{approvedAt:at(1000).toISOString(),holding:approvedHolding,cash:approvedCash})).toMatchObject({actualNetQuoteCredit:"99.5"});
 expect(()=>reconcileDisposalFixture(r,observation,{...p,cashBefore:cash("0",1000),cashAfter:cash("99.5",2000)},at(2000),{approvedAt:at(1000).toISOString(),holding:approvedHolding,cash:approvedCash})).toThrow();
});
