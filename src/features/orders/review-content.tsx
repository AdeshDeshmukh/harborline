import type { ReviewScreen, ReviewStatus } from "./screen-types";
import { exactDisplayAmount } from "./review-screen";

export const reviewStatusCopy:Record<ReviewStatus,{title:string;detail:string}>={
  current:{title:"Terms recorded. Take a closer look.",detail:"This is a sample review. Approval is unavailable, even while its local review window is open."},
  expired:{title:"The review window has ended.",detail:"These are historical terms. Reloading saved terms does not request a new quote or extend this deadline."},
  changed_plan:{title:"Your plan has changed.",detail:"These terms describe an earlier plan. They cannot be used for a purchase; a new review would be required."},
  stale_balance:{title:"The cash evidence needs refreshing.",detail:"The saved cash explanation is historical. It cannot establish what is available to spend now."},
  uncertain:{title:"The outcome needs checking.",detail:"This operation is unresolved. Do not start another purchase; its account slot stays held until the outcome is reconciled."},
  closed:{title:"This is a historical review.",detail:"These terms cannot be approved again. A saved review is not proof of a completed trade."},
  preparing:{title:"Preparation has not produced a review yet.",detail:"Reload only to check the saved record. This screen never repeats a preparation request."},
  superseded:{title:"This review is no longer current.",detail:"Its operation or preparation has been replaced. These terms cannot be restored or approved."},
  missing:{title:"Saved terms are unavailable.",detail:"An operation exists, but a complete immutable review could not be found. Approval remains unavailable."},
  unavailable:{title:"These terms could not be verified.",detail:"No purchase can proceed. Reload the saved record or return to your plan."},
};
const card="rounded-3xl border border-slate-700 bg-slate-900/50 p-5 sm:p-7";
function Value({label,value,unit="USDC"}:{label:string;value:string;unit?:string}){
  return <div className="min-w-0"><dt className="text-sm leading-6 text-slate-400">{label}</dt><dd className="mt-1 break-all text-xl font-medium tabular-nums text-slate-100">{exactDisplayAmount(value,unit==="USDC"?2:0)} <span className="text-sm font-normal text-slate-400">{unit}</span></dd></div>;
}
export function ReviewContent({screen,status=screen.status}:{screen:ReviewScreen;status?:ReviewStatus}){
  const review=screen.review,copy=reviewStatusCopy[status];
  return <div className="space-y-6">
    <header className="pt-6"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Investment review</p><h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">Know what would leave.<br className="hidden sm:block"/> See what would remain.</h1><p className="mt-4 max-w-2xl leading-7 text-slate-300">The terms, costs, and cash explanation together, before a decision.</p></header>
    <aside aria-label={screen.sample?"Sample disclosure":review?"Stored terms source":"Operation record"} className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100"><strong>{screen.sample?"Sample terms · no real funds.":review?"Stored fixture terms.":"Saved operation."}</strong> {screen.sample?"This public illustration uses a fictional token and cash plan. Its illustrative times restart when you open it again.":review?"These figures are illustrative stored terms, not live provider evidence or your confirmed wallet balance.":"No current financial terms could be verified. The operation’s outcome must be checked; this screen cannot establish whether funds moved."}</aside>
    <section aria-labelledby="review-status-heading" className="rounded-2xl border border-amber-300/25 p-5"><h2 id="review-status-heading" className="text-lg font-medium text-amber-100">{copy.title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{copy.detail}</p></section>
    {review?<>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section aria-labelledby="terms-heading" className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Tokenized stock exposure</p><h2 id="terms-heading" className="mt-2 break-words text-2xl font-semibold">{review.quote.baseIdentifier}</h2></div><span className="rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-300">Solana · DeFi</span></div>
          <p className="mt-4 text-sm leading-6 text-slate-300">{screen.sample?"Fictional example token. This does not represent a real stock or investment product.":"Issuer information has not been verified for this preview. The symbol alone does not establish a token’s rights or redemption terms."}</p>
          <dl className="mt-6 grid gap-5 sm:grid-cols-2"><Value label="Requested input" value={review.quote.inputAmount}/><Value label="Expected token quantity" value={review.quote.expectedOutput} unit={review.quote.baseIdentifier}/><Value label="Quoted fee" value={review.quote.feeAmount}/><Value label="Maximum debit" value={review.maximumDebit}/></dl>
          <p className="mt-5 rounded-xl border border-slate-700 p-3 text-sm leading-6 text-slate-300">{review.feeTreatment==="added_to_input"?"The quoted fee is added to the requested input in this example.":"The quoted fee is included in the requested input in this example."} The maximum debit is the amount used in the cash explanation.</p>
          <p className="mt-4 text-xs leading-5 text-slate-400">Expected quantity is an estimate, not a confirmed fill. This sample cap does not establish an enforceable live provider limit.</p>
        </section>
        <section aria-labelledby="cash-heading" className={card}>
          <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Your before-and-after explanation</p><h2 id="cash-heading" className="mt-2 text-xl font-medium">Room for what matters.</h2>
          <dl className="mt-6 space-y-5"><Value label="Cash before this example" value={review.cash.available}/><div className="border-y border-slate-700 py-5"><dt className="text-sm text-slate-300">Cash after the maximum debit</dt><dd className="mt-2 break-all text-4xl font-semibold tabular-nums tracking-tight text-cyan-200">{exactDisplayAmount(review.cash.afterMaximumDebit)} <span className="text-base font-normal text-slate-400">USDC</span></dd></div></dl><dl className="mt-5 grid gap-5 sm:grid-cols-2"><Value label="Planned for commitments" value={review.cash.commitments}/><Value label="Additional buffer" value={review.cash.buffer}/></dl>
          <p className="mt-5 text-sm leading-6 text-slate-300">The remaining cash includes these commitments and your additional buffer. Your plan describes intended use; it does not lock or segregate funds.</p><p className="mt-4 text-xs leading-5 text-slate-400">Based only on the cash observation and commitments in this example. Missing bills, conversion costs, and future income are not included.</p>
        </section>
      </div>
      <section aria-labelledby="timing-heading" className="rounded-2xl border border-slate-700 p-5"><h2 id="timing-heading" className="text-base font-medium">A short window, not a price guarantee.</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{[["Quote observed",review.quote.observedAt],["Local review expiry",review.localExpiresAt]].map(([label,time])=><div key={label}><dt className="text-slate-400">{label}</dt><dd className="mt-1 break-words"><time dateTime={time}>{time.replace("T"," ").replace("Z"," UTC")}</time></dd></div>)}</dl><p className="mt-3 text-xs leading-5 text-slate-400">The local 20-second policy is not a provider validity guarantee. Live terms can become invalid sooner.</p></section>
    </>:null}
    <section aria-labelledby="approval-heading" className="rounded-2xl border border-slate-600 p-5"><h2 id="approval-heading" className="text-lg font-medium">Approval unavailable</h2><p className="mt-2 text-sm leading-6 text-slate-300">This screen cannot approve, sign, or execute a purchase. Live preparation and trading remain disabled while the provider requirements are verified.</p></section>
  </div>;
}
