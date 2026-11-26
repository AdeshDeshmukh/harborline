import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {sampleActivity} from "../src/features/orders/sample-activity.server";
import {ActivityContent} from "../src/features/orders/activity-content";
const html=(name:string)=>renderToStaticMarkup(createElement(ActivityContent,{screen:sampleActivity(name)}));
test("sale receipt separates estimates, actual proceeds and independent verification",()=>{
 const s=html("sale-complete");for(const text of ["Saved sale review","Estimated net proceeds","Actual net proceeds","Stock and cash verified manually","99.50 USDC","0.50 asset units","Original approval","Sample · no real funds"])expect(s).toContain(text);
 expect(s).not.toMatch(/Maximum approved debit|Actual order debit|Some assets may have been bought|href="https:/);
});
test("partial failed sale preserves proceeds and unverified stock/cash without retry controls",()=>{
 const s=html("sale-partial");for(const text of ["Some assets may have been sold","39.80 USDC","Stock and cash not yet verified","0.30 asset units"])expect(s).toContain(text);
 expect(s).not.toMatch(/No funds moved|<button|href="https:/);
});
test("sale examples contain no private evidence and list entries identify the side",()=>{
 for(const name of ["sale-complete","sale-partial"]){expect(JSON.stringify(sampleActivity(name))).not.toMatch(/providerUserId|operatorId|holdingReadId|ciphertext|private_key/);}
 expect(html("list")).toContain("Sale ·");
});

test("sale review shows the independently approved maximum fee and proceeds treatment",()=>{
 const s=html("sale-complete");expect(s).toContain("Maximum fee");expect(s).toContain("1.00 USDC");expect(s).toContain("Fees are deducted from proceeds");
 const sample=sampleActivity("sale-complete");if(sample.data.kind!=="order")throw new Error();expect(sample.data.order.sale?.review).toMatchObject({quotedFeeQuote:"0.5",maximumFeeQuote:"1"});
});
