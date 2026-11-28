import { exactDisplayAmount } from "../orders/review-screen";
import type { AllowanceResult } from "../planning/types";
import { demoCash } from "./demo-plan";

export function CashBreakdown({ allowance }: { allowance: AllowanceResult }) {
  const { commitmentsTotal, additionalBuffer, debitBudget, shortfall } = allowance;
  const cash = Number(demoCash);
  // The bar visualizes the cash on hand. The exact planned amounts stay in the ledger.
  const rentWithinCash = Math.min(Number(commitmentsTotal), cash);
  const bufferWithinCash = Math.min(Number(additionalBuffer), cash - rentWithinCash);

  return (
    <section aria-labelledby="allowance-title" className="harbor-cash">
      <div className="harbor-cash-heading">
        <h2 id="allowance-title">Sample investing allowance</h2>
        <p className="harbor-cash-total">{exactDisplayAmount(debitBudget)} <span>USDC</span></p>
      </div>

      <div className="harbor-cash-ledger">
        <p className="harbor-cash-balance"><span>Sample cash</span><strong>{exactDisplayAmount(demoCash)} USDC</strong></p>
        <div aria-hidden="true" className="harbor-cash-band">
          <span className="harbor-cash-rent" style={{ flexGrow: rentWithinCash }} />
          <span className="harbor-cash-buffer" style={{ flexGrow: bufferWithinCash }} />
          <span className="harbor-cash-available" style={{ flexGrow: Number(debitBudget) }} />
        </div>
        <dl className="harbor-cash-key">
          <div>
            <dt><span aria-hidden="true" className="harbor-cash-rent" />Rent due</dt>
            <dd>{exactDisplayAmount(commitmentsTotal)}</dd>
          </div>
          <div>
            <dt><span aria-hidden="true" className="harbor-cash-buffer" />Personal buffer</dt>
            <dd>{exactDisplayAmount(additionalBuffer)}</dd>
          </div>
          <div>
            <dt><span aria-hidden="true" className="harbor-cash-available" />Left to invest</dt>
            <dd>{exactDisplayAmount(debitBudget)}</dd>
          </div>
        </dl>
        {shortfall !== "0" && <p className="harbor-shortfall">Your sample cash falls short by {exactDisplayAmount(shortfall)} USDC.</p>}
      </div>
    </section>
  );
}
