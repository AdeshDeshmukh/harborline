"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { exactDisplayAmount } from "../orders/review-screen";
import { CashBreakdown } from "./cash-breakdown";
import { applyDemoCommitment, demoAllowance, demoReviewScenario, startDemo } from "./demo-plan";

const examples = [
  { id: "expired", label: "Expired quote" },
  { id: "rejected", label: "Rejected quote" },
  { id: "unknown", label: "Uncertain order" },
  { id: "verified", label: "Verified receipt" },
] as const;
type Example = (typeof examples)[number]["id"];
type Step = "plan" | "review" | Example;
type Views = Readonly<Record<"current" | "changed" | Example, ReactNode>>;
const headings: Record<Step, string> = {
  plan: "Invest with room for what’s due.",
  review: "Check the saved review",
  expired: "When a quote expires",
  rejected: "When a quote is rejected",
  unknown: "When an order is uncertain",
  verified: "When cash is verified",
};
const amount = (value: string) => exactDisplayAmount(value) + " USDC";
const initialAllowance = demoAllowance(startDemo()).debitBudget;
const exampleRent = "1500";

export function DemoWorkspace({ views }: { views: Views }) {
  const [step, setStep] = useState<Step>("plan");
  const [plan, setPlan] = useState(startDemo);
  const [rentInput, setRentInput] = useState(plan.rent);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const rentField = useRef<HTMLInputElement>(null);
  const focusRequested = useRef(false);
  const allowance = demoAllowance(plan);
  const reviewScenario = demoReviewScenario(plan);

  useEffect(() => {
    if (!focusRequested.current) return;
    title.current?.focus();
    focusRequested.current = false;
  }, [step]);

  function open(next: Step) {
    if (next === step) return;
    focusRequested.current = true;
    setStep(next);
  }

  function applyRent(value: string) {
    try {
      const updated = applyDemoCommitment(plan, value);
      const nextAllowance = demoAllowance(updated);
      setPlan(updated);
      setRentInput(updated.rent);
      setError("");
      setNotice(updated === plan
        ? "The sample commitment is unchanged."
        : "Sample commitment updated. Investing allowance is now " + amount(nextAllowance.debitBudget) + ".");
    } catch {
      setNotice("");
      setError("Enter a positive amount with up to two decimal places, such as 1500 or 1500.50.");
      rentField.current?.focus();
    }
  }

  function saveCommitment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyRent(rentInput);
  }

  function reset() {
    const initial = startDemo();
    setPlan(initial);
    setRentInput(initial.rent);
    setError("");
    setNotice("Walkthrough reset. The investing allowance is " + amount(initialAllowance) + ".");
    if (step === "plan") title.current?.focus();
    else open("plan");
  }

  return (
    <div id="walkthrough" tabIndex={-1} className="harbor-workspace">
      <h1 ref={title} tabIndex={-1} className="harbor-workspace-title">{headings[step]}</h1>

      {step === "plan" ? (
        <>
          <p className="harbor-workspace-intro">Change the sample rent, then see what that means for a saved investment review.</p>
          <div className="harbor-plan">
            <CashBreakdown allowance={allowance} />
            <section aria-labelledby="rent-title" className="harbor-controls">
              <h2 id="rent-title">Change a commitment</h2>
              <p id="rent-hint">Try a higher rent or enter your own amount.</p>
              <form onSubmit={saveCommitment} noValidate>
                <label htmlFor="sample-rent">Rent due (USDC)</label>
                <input id="sample-rent" ref={rentField} type="text" inputMode="decimal" value={rentInput}
                  onChange={event => { setRentInput(event.target.value); setError(""); }}
                  aria-invalid={!!error} aria-describedby={error ? "rent-hint rent-error" : "rent-hint"}
                  className="harbor-rent-input" />
                {error && <p id="rent-error" role="alert" className="harbor-input-error">{error}</p>}
                <div className="harbor-form-actions">
                  <button className="harbor-button" type="submit">Save sample commitment</button>
                  <button className="harbor-button harbor-preset" type="button" onClick={() => applyRent(exampleRent)}>
                    Try {exactDisplayAmount(exampleRent, 0)} USDC rent
                  </button>
                </div>
              </form>
              <p className="harbor-notice" role="status">{notice}</p>
              <button className="harbor-button harbor-button-primary harbor-review-link" type="button" onClick={() => open("review")}>
                Open saved review <span aria-hidden="true">→</span>
              </button>
            </section>
          </div>
        </>
      ) : (
        <div className="harbor-saved-view">
          {step === "review" && reviewScenario === "changed" && (
            <section aria-labelledby="harbor-comparison-title" className="harbor-comparison">
              <h2 id="harbor-comparison-title">Sample allowance comparison</h2>
              <dl>
                <div><dt>When reviewed</dt><dd>{amount(initialAllowance)}</dd></div>
                <div><dt>After the change</dt><dd>{amount(allowance.debitBudget)}</dd></div>
              </dl>
              <p>Rent changed after this review. A new review would be needed before investing. The original terms are shown below.</p>
            </section>
          )}
          {(step === "unknown" || step === "verified") && (
            <p className="harbor-workspace-intro">This is a separate fictional order. The examples do not update one another.</p>
          )}
          <button className="harbor-button" type="button" onClick={() => open("plan")}>
            <span aria-hidden="true">←</span>
            {step === "review" ? "Edit sample plan" : "Back to sample plan"}
          </button>
          <div className="harbor-record">{views[step === "review" ? reviewScenario : step]}</div>
        </div>
      )}

      <footer className="harbor-example-footer">
        <details>
          <summary>Explore quote and order examples</summary>
          <nav aria-label="Quote and order examples">
            {examples.map(({ id, label }) => (
              <button key={id} type="button" onClick={() => open(id)} aria-current={id === step ? "step" : undefined}
                className="harbor-button">{label}</button>
            ))}
          </nav>
        </details>
        <button type="button" onClick={reset} className="harbor-link">Restart walkthrough</button>
      </footer>
    </div>
  );
}
