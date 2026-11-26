import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {sampleActivity} from "../src/features/orders/sample-activity.server";
import {ActivityContent} from "../src/features/orders/activity-content";
import {activityReloadState} from "../src/features/orders/activity-panel-state";
const html=(scenario:string)=>renderToStaticMarkup(createElement(ActivityContent,{screen:sampleActivity(scenario)}));
test("complete outcome remains separate from cash verification",()=>{
 expect(html("complete")).toContain("Cash not yet verified");expect(html("complete")).toContain("Order reported complete");expect(html("complete")).not.toContain("Cash verified manually");
});
test("manual receipt shows original cash and actual economics separately from estimates",()=>{
 const content=html("verified");for(const text of ["Cash verified manually","2,000.00","1,899.50","100.50","Quoted fee","Recorded fee","Original approval","Not recorded","Sample · no real funds"])expect(content).toContain(text);
 expect(content).not.toMatch(/href="https:|<button[^>]*>.*(Trade|Retry|Buy)/);
});
test("uncertainty and partial failure never invite another order",()=>{
 expect(html("unknown")).toContain("Do not place another order");expect(html("partial-failed")).toContain("Some assets may have been bought");expect(html("partial-failed")).not.toContain("No funds moved");
});
test("pending, manual review, empty and list examples render meaningful next steps",()=>{
 expect(html("pending")).toContain("Order in progress");expect(html("review")).toContain("Review required");expect(html("empty")).toContain("No saved orders yet");expect(html("list")).toContain("View saved order");
});
test("unknown actuals are labeled rather than replaced by quote estimates",()=>{
 const screen=sampleActivity("complete");if(screen.data.kind!=="order")throw new Error();
 const content=renderToStaticMarkup(createElement(ActivityContent,{screen:{...screen,data:{kind:"order",order:{...screen.data.order,actual:{...screen.data.order.actual!,filledBase:null,feeQuote:null}}}}}));
 expect(content).toContain("Not recorded");expect(content).toContain("Expected quantity");
});
test("failed refresh, sign-out and mismatched success clear all private content",()=>{
 const previous={...sampleActivity("verified"),sample:false};
 for(const code of ["unavailable","unauthenticated","session_changed"] as const){const state=activityReloadState(previous,{ok:false,code,message:"Unable"});expect(state.screen).toBeNull();expect(state.locked).toBe(code!=="unavailable");}
 const changed=activityReloadState(previous,{ok:true,screen:{...previous,scope:"another-account"}});expect(changed.screen).toBeNull();expect(changed.locked).toBe(true);
});
test("latest check uses readable descriptions instead of internal dispositions",()=>{
 const content=html("unknown");expect(content).toContain("Read unavailable");expect(content).not.toContain("unavailable · applied");
});

test("manual review does not invent contradictory provider reports",()=>{
 const content=html("review");expect(content).toContain("Review required");expect(content).not.toContain("reports disagree");
});
test("verified receipt names approved network and intervening movements separately",()=>{
 const screen=sampleActivity("verified");if(screen.data.kind!=="order")throw new Error();
 const order={...screen.data.order,settlement:{...screen.data.order.settlement!,cashAfter:"1900.25",interveningCredits:"1",interveningDebits:"0.25"}};
 const content=renderToStaticMarkup(createElement(ActivityContent,{screen:{...screen,data:{kind:"order",order}}}));
 for(const text of ["Approved network","Solana","Other credits during verification","Other debits during verification","1.00 USDC","0.25 USDC"])expect(content).toContain(text);
});
