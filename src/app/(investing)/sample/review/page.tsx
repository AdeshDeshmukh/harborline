import { ReviewPanel } from "../../../../features/orders/review-panel";
import { createSampleReviewScreen, type SampleReviewScenario } from "../../../../features/orders/sample-review.server";
export default async function SampleReviewPage({searchParams}:{searchParams:Promise<{state?:string|string[]}>}){
  const state=(await searchParams).state;
  const scenario:SampleReviewScenario=state===undefined||state==="current"?"current":state==="expired"||state==="changed"||state==="unavailable"?state:"unavailable";
  const screen=createSampleReviewScreen(scenario);
  return <ReviewPanel key={screen.serverNow+scenario} initial={screen}/>;
}
