import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createSampleReviewScreen} from "../src/features/orders/sample-review.server";
import {ReviewContent} from "../src/features/orders/review-content";
import {ReviewPanel} from "../src/features/orders/review-panel";
const now=new Date("2026-11-25T12:00:05.000Z");
test("sample terms are isolated, labeled and retain hand-checked cash impact",()=>{
  const screen=createSampleReviewScreen("current",now);
  expect(screen).toMatchObject({sample:true,canProceed:false,status:"current",review:{source:"contract_fixture",maximumDebit:"100.5",cash:{available:"2000",commitments:"1200",buffer:"500",afterMaximumDebit:"1899.5"}}});
  expect(JSON.stringify(screen)).not.toMatch(/payload|ciphertext|nonce|private_key/);
});
test("review renders exact fees, denomination, exposure and maximum-debit explanation",()=>{
  const html=renderToStaticMarkup(createElement(ReviewContent,{screen:createSampleReviewScreen("current",now)}));
  for(const text of ["100.50","1,899.50","1,200.00","500.00","0.50","USDC","Solana","Tokenized","Sample","Approval unavailable"])expect(html).toContain(text);
  expect(html).not.toMatch(/<button[^>]*>Approve purchase/);expect(html).not.toContain("signatures");
});
test.each(["expired","changed","unavailable"] as const)("%s sample state explains why no purchase can proceed",scenario=>{
  const screen=createSampleReviewScreen(scenario,now),html=renderToStaticMarkup(createElement(ReviewContent,{screen}));
  expect(screen.canProceed).toBe(false);expect(html).toContain("Approval unavailable");expect(html).not.toMatch(/<form[^>]*action=.*approve/);
});
test("owned uncertainty without verified terms never promises no real funds",()=>{
  const screen={...createSampleReviewScreen("current",now),sample:false,review:null,status:"uncertain" as const};
  const html=renderToStaticMarkup(createElement(ReviewContent,{screen}));
  expect(html).toContain("The outcome needs checking.");expect(html).not.toContain("no real funds");expect(html).not.toContain("fixture data");
});
test("the review shows elapsed quote age independently of time remaining",()=>{
  const html=renderToStaticMarkup(createElement(ReviewPanel,{initial:createSampleReviewScreen("current",now)}));
  expect(html).toContain("Quote age: 5 seconds");
});
