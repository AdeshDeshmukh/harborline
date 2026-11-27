"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { exactDisplayAmount } from "../orders/review-screen";
import { applyDemoCommitment, demoAllowance, demoCash, demoReviewScenario, startDemo } from "./demo-plan";

const steps = [
  { id: "plan", label: "Sample plan" },
  { id: "review", label: "Saved review" },
  { id: "expired", label: "Expired quote" },
  { id: "rejected", label: "Rejected quote" },
  { id: "unknown", label: "Uncertain order" },
  { id: "verified", label: "Verified receipt" },
] as const;
type Step = (typeof steps)[number]["id"];
type Views = Readonly<Record<"current" | "changed" | Exclude<Step, "plan" | "review">, ReactNode>>;
const headings: Record<Step, string> = {
  plan: "Invest with room for what’s due.",
  review: "Check the saved review",
  expired: "When a quote expires",
  rejected: "When a quote is rejected",
  unknown: "When an order is uncertain",
  verified: "When cash is verified",
};
const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-cyan-200 hover:border-cyan-300";
const amount = (value: string) => exactDisplayAmount(value) + " USDC";
const initialAllowance = demoAllowance(startDemo()).debitBudget;

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
  const changed = demoReviewScenario(plan) === "changed";

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

  function saveCommitment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const updated = applyDemoCommitment(plan, rentInput);
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
    <div id="walkthrough" tabIndex={-1} className="py-6 sm:py-9">
      <nav aria-label="Walkthrough steps" className="flex flex-wrap items-center gap-2">
        {steps.map(({ id, label }) => (
          <button key={id} type="button" onClick={() => open(id)} aria-current={id === step ? "step" : undefined}
            className={secondary + (id === step ? " border-cyan-300 bg-cyan-300/10" : "")}>{label}</button>
        ))}
        <button type="button" onClick={reset} className="min-h-11 px-3 text-sm text-slate-300 underline underline-offset-4 hover:text-cyan-200 sm:ml-auto">Restart walkthrough</button>
      </nav>

      <h1 ref={title} tabIndex={-1} className="mt-8 text-3xl font-semibold tracking-tight sm:text-5xl">{headings[step]}</h1>
      <div className={step === "plan" ? "mt-4 text-sm leading-6 text-cyan-200" : "sr-only"} role="status">{notice}</div>

      {step === "plan" ? (
        <>
          <p className="mt-4 max-w-2xl leading-7 text-slate-300">See how rent and a personal buffer shape what you can set aside to invest.</p>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            <section aria-labelledby="allowance-title" className="min-w-0 rounded-2xl border border-cyan-400/40 bg-slate-900 p-5 sm:p-7">
              <h2 id="allowance-title" className="text-sm font-medium text-slate-300">Sample investing allowance</h2>
              <p className="mt-2 break-words text-3xl font-semibold tabular-nums text-cyan-200 sm:text-4xl">{amount(allowance.debitBudget)}</p>
              <dl className="mt-5 divide-y divide-slate-800 text-sm">
                {([
                  ["Sample cash", demoCash],
                  ["Set aside for rent", allowance.commitmentsTotal],
                  ["Personal buffer", allowance.additionalBuffer],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3">
                    <dt className="text-slate-400">{label}</dt>
                    <dd className="min-w-0 break-words tabular-nums">{amount(value)}</dd>
                  </div>
                ))}
              </dl>
              {allowance.shortfall !== "0" && <p className="mt-2 break-words text-sm text-amber-200">Your sample cash falls short by {amount(allowance.shortfall)}.</p>}
            </section>

            <section aria-labelledby="rent-title" className="rounded-2xl border border-slate-700 bg-slate-900/50 p-5 sm:p-7">
              <h2 id="rent-title" className="text-lg font-semibold">Change a commitment</h2>
              <p id="rent-hint" className="mt-2 text-sm leading-6 text-slate-300">Try 1500 USDC for rent, then reopen the saved review.</p>
              <form onSubmit={saveCommitment} noValidate className="mt-5">
                <label htmlFor="sample-rent" className="block text-sm font-medium">Rent due (USDC)</label>
                <input id="sample-rent" ref={rentField} type="text" inputMode="decimal" value={rentInput}
                  onChange={event => { setRentInput(event.target.value); setError(""); }}
                  aria-invalid={!!error} aria-describedby={error ? "rent-hint rent-error" : "rent-hint"}
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-500 bg-slate-950 px-3 text-slate-100 tabular-nums" />
                {error && <p id="rent-error" role="alert" className="mt-2 text-sm leading-6 text-rose-200">{error}</p>}
                <button className={primary + " mt-4"} type="submit">Save sample commitment</button>
              </form>
            </section>
          </div>
          <button className={secondary + " mt-5"} type="button" onClick={() => open("review")}>Open saved review</button>
        </>
      ) : (
        <div className="mt-5 space-y-5">
          {step === "review" && changed && (
            <p className="rounded-2xl border border-cyan-400/40 p-4 leading-7 text-cyan-100">
              Current sample allowance is <strong>{amount(allowance.debitBudget)}</strong>. The saved review used the earlier {amount(initialAllowance)} allowance.
            </p>
          )}
          {(step === "unknown" || step === "verified") && (
            <p className="max-w-2xl leading-7 text-slate-300">This is a separate fictional order. The examples do not update one another.</p>
          )}
          {views[step === "review" ? demoReviewScenario(plan) : step]}
          {step === "review" && <button className={secondary} type="button" onClick={() => open("plan")}>Edit sample plan</button>}
        </div>
      )}
    </div>
  );
}
