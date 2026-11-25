import Link from "next/link";
import { getAccountPageContext } from "../../../account/context.server";
import { createReviewScreenController } from "../../../../features/orders/screen.server";
import { ReviewPanel } from "../../../../features/orders/review-panel";
import { reloadReview } from "./actions";
export default async function ReviewPage({params}:{params:Promise<{intentId:string}>}){
  const context=await getAccountPageContext();
  if(!context)return <div role="alert" className="py-12"><h1 className="text-3xl">Your account is unavailable.</h1><p className="mt-4">We could not verify saved terms.</p></div>;
  const {intentId}=await params,result=await createReviewScreenController({owner:async()=>context}).load(intentId,context.accountId);
  if(!result.ok)return <div role="alert" className="py-12"><h1 className="text-3xl font-semibold">Review unavailable</h1><p className="mt-4 leading-7 text-slate-300">{result.message}</p><Link href="/plan" className="mt-6 inline-flex min-h-11 items-center text-cyan-200 underline">Return to your plan</Link></div>;
  return <ReviewPanel key={context.accountId+result.screen.serverNow} initial={result.screen} reload={reloadReview}/>;
}
