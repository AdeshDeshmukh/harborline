"use client";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { changePlan, previewAmount, refreshPlan } from "../../app/(planning)/actions";
import type { PlanningMutation, PlanningResponse, PlanningScreen } from "./screen-types";
import type { PlanView } from "./storage-types";
import { formatAmountDown, parseAmount } from "./money";
import { hasDuplicateCommitment, isEditStale } from "./draft";

const inputClass = "mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 text-base text-slate-100 focus:border-cyan-300 focus:outline-2 focus:outline-cyan-300";
const buttonClass = "min-h-11 rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-100 hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 disabled:cursor-wait disabled:opacity-50";
const moneyPattern = "(0|[1-9][0-9]*)(\\.[0-9]{1,2})?";
function amount(value: string) {
  const [whole, fraction] = formatAmountDown(parseAmount(value)).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export function PlanningWorkspace({ initial, scope, overview = false }: { initial: PlanningResponse; scope: string; overview?: boolean }) {
  const [screen, setScreen] = useState<PlanningScreen | null>(initial.ok ? initial.screen : null);
  const [error, setError] = useState(initial.ok ? "" : initial.message);
  const [errorCode, setErrorCode] = useState(initial.ok ? "" : initial.code);
  const [blocked, setBlocked] = useState(!initial.ok && initial.reloadRequired);
  const [announcement, setAnnouncement] = useState("");
  const [editing, setEditing] = useState<PlanView["commitments"][number] | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [previewAttempted, setPreviewAttempted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  const notice = useRef<HTMLDivElement>(null), locked = useRef(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (error) notice.current?.focus(); }, [error]);
  useEffect(() => { if (editing) document.getElementById("commitment-label")?.focus(); }, [editing]);
  const snapshot = screen?.snapshot;
  const expired = !!snapshot && now !== null && (now - Date.parse(snapshot.balance.observedAt) > 15000 || now < Date.parse(snapshot.balance.observedAt));
  const unverifiedFreshness = !!snapshot && now === null;
  function run(work: () => Promise<PlanningResponse>, success: string, after?: () => void) {
    if (locked.current) return;
    locked.current = true;
    startTransition(async () => {
      try {
        const response = await work();
        if (response.ok) { setScreen(response.screen); setNow(Date.now()); setError(""); setErrorCode(""); setBlocked(false);
          setAnnouncement(response.screen.calculationError ? success === "Plan saved." ? "Plan saved. The explanation could not be refreshed." : "The sample explanation could not be refreshed. Review the message below." : success); after?.(); }
        else { setError(response.message); setErrorCode(response.code); setBlocked(response.reloadRequired); setAnnouncement(""); }
      } catch { setError("We could not confirm this request. Reload your plan before trying again."); setBlocked(true); }
      finally { locked.current = false; }
    });
  }
  function mutate(kind: PlanningMutation, input: Record<string, unknown>, after?: () => void) {
    if (!screen || blocked) return;
    run(() => changePlan(screen.scope, kind, { ...input, expectedRevision: screen.plan.revision }), "Plan saved.", () => { setPreviewAttempted(false); after?.(); });
  }
  const canEdit = !!screen && !blocked && !pending;
  const staleDraft = !!screen && isEditStale(screen.plan, editing);
  return <div className="space-y-7">
    <header className="pt-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">{overview ? "Your overview" : "Your cash plan"}</p>
      <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">{overview ? "See your room to breathe." : "Make room for what matters."}</h1>
      <p className="mt-4 max-w-2xl leading-7 text-slate-300">Set aside upcoming commitments and an extra buffer. See what remains before considering an investment.</p>
    </header>
    <div className="rounded-2xl border border-amber-400/30 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100">
      <strong>Sample balance · no real funds.</strong> This explanation uses a fictional 2,000.00 USDC balance. Your saved commitments are yours; this is not your wallet balance. Trading is unavailable.
    </div>
    {error && <div ref={notice} tabIndex={-1} role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-400/5 p-4 text-rose-100">
      <p>{error}</p><p className="mt-2 text-sm">Unsaved commitment fields stay in the form. Review the latest plan before retrying.</p>
      {errorCode === "unauthenticated" && <Link href="/sign-in" className="mt-3 inline-block underline">Sign in again</Link>}
      {errorCode === "session_changed" && <a href="/plan" className="mt-3 inline-block underline">Open the current account&apos;s plan</a>}
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" aria-live="polite" className="text-sm text-slate-300">{pending ? "Updating your plan…" : announcement || "Amounts are in USDC-equivalent planning units."}</p>
      <button type="button" disabled={pending || errorCode === "session_changed"} onClick={() => {
        run(() => refreshPlan(screen?.scope ?? scope), "Latest plan loaded.", () => setPreviewAttempted(false));
      }} className={buttonClass}>Reload plan &amp; sample</button>
    </div>
    {screen && <>
      <section aria-labelledby="allowance-heading" className="rounded-3xl border border-slate-700 bg-slate-900/60 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">After commitments + buffer</p><h2 id="allowance-heading" className="mt-2 text-xl font-medium">Estimated room</h2></div>
          <span className={`rounded-full border px-3 py-1 text-xs ${expired ? "border-amber-500/50 text-amber-200" : "border-slate-600 text-slate-300"}`}>{expired ? "Sample explanation expired" : unverifiedFreshness ? "Sample freshness unverified" : "Sample · not investment authority"}</span>
        </div>
        {snapshot ? <>
          <p className="mt-5 break-all text-4xl font-semibold tracking-tight text-cyan-200 sm:text-6xl">{amount(snapshot.result.debitBudget)} <span className="text-base font-normal text-slate-400">USDC</span></p>
          <dl className="mt-7 grid gap-4 border-t border-slate-700 pt-5 sm:grid-cols-3">
            {[["Sample cash", snapshot.input.available], ["Included commitments", snapshot.result.commitmentsTotal], ["Additional buffer", snapshot.result.additionalBuffer]].map(([name, value]) => <div key={name}><dt className="text-sm text-slate-400">{name}</dt><dd className="mt-1 break-all text-xl font-medium">{amount(value)}</dd></div>)}
          </dl>
          <p className="mt-5 text-sm leading-6 text-slate-300">Cash minus included commitments minus buffer, with a minimum of zero. Outstanding commitments due by <strong>{snapshot.horizonEnd}</strong> count, including overdue items. Paid and removed items do not.</p>
          {snapshot.result.shortfall !== "0" ? <p className="mt-4 rounded-xl bg-amber-300/10 p-4 text-sm leading-6 text-amber-100"><strong>Shortfall: {amount(snapshot.result.shortfall)} USDC.</strong> Your commitments and buffer exceed this sample balance. Zero room is a valid outcome; review your plan before considering an investment.</p> : snapshot.result.debitBudget === "0" ? <p className="mt-4 text-sm text-amber-100">Your commitments and buffer use all of this sample balance. There is no remaining room.</p> : null}
          <p className="mt-5 break-words text-xs leading-5 text-slate-400">Sample observed {snapshot.balance.observedAt} · Local planning date {snapshot.input.asOfLocalDate} ({snapshot.input.timezone}) · 15-second freshness window.</p>
          {expired && <p className="mt-2 text-sm text-amber-200">This is a historical explanation. Reload the sample to see a current illustration.</p>}
          <p className="mt-3 text-xs leading-5 text-slate-400">An estimate based on the commitments you enter, not a suitability assessment or a promise of safe returns.</p>
        </> : <p role={screen.calculationError ? "alert" : undefined} className="mt-5 leading-7 text-slate-300">{screen.calculationError || (overview ? "Confirm a horizon and buffer on your plan to see an explanation." : "Confirm a horizon and additional buffer below to see your explanation.")}</p>}
        {screen.calculationError && snapshot && <p role="alert" className="mt-3 text-amber-100">{screen.calculationError}</p>}
      </section>
      {overview ? <div className="rounded-2xl border border-slate-700 p-5"><h2 className="text-xl font-medium">Keep your plan up to date.</h2><p className="mt-3 text-sm leading-6 text-slate-300">An omitted bill changes this estimate. Review one-time commitments, due dates, and your buffer before making a decision.</p><Link href="/plan" className="mt-4 inline-flex min-h-11 items-center text-cyan-300 underline underline-offset-4">Manage commitments and buffer →</Link></div> : <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.35fr]">
        <section aria-labelledby="policy-heading" className="rounded-2xl border border-slate-700 p-5">
          <h2 id="policy-heading" className="text-xl font-medium">Your planning policy</h2><p className="mt-2 text-sm leading-6 text-slate-400">The buffer is additional to your bills. Include every commitment you need to protect.</p>
          <form key={screen.plan.policy?.acknowledgedAt ?? "new-policy"} className="mt-5 space-y-4" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            mutate("savePolicy", { horizonDays: Number(data.get("horizonDays")), additionalBuffer: data.get("buffer"), acknowledged: data.get("acknowledged") === "on" });
          }}>
            <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-60">
              <label className="block text-sm">Planning horizon (days)<input name="horizonDays" type="number" min="1" max="90" step="1" required defaultValue={screen.plan.policy?.horizonDays ?? 30} className={inputClass} /></label>
              <label className="block text-sm">Additional buffer (USDC)<input name="buffer" inputMode="decimal" pattern={moneyPattern} title="Enter a nonnegative amount with up to two decimal places" maxLength={23} required defaultValue={screen.plan.policy?.additionalBuffer ?? "500"} className={inputClass} /></label>
              <label className="flex items-start gap-3 text-sm leading-6"><input name="acknowledged" type="checkbox" required className="mt-1 size-5 shrink-0 accent-cyan-300" /><span>I reviewed my commitments and understand that missing bills change this estimate.</span></label>
              <button className={`${buttonClass} w-full border-cyan-300/50 bg-cyan-300/10 text-cyan-100`}>Confirm planning policy</button>
            </fieldset>
          </form>
        </section>
        <section aria-labelledby="commitment-heading" className="rounded-2xl border border-slate-700 p-5">
          <h2 id="commitment-heading" className="text-xl font-medium">{editing ? "Edit commitment" : "Add a commitment"}</h2><p className="mt-2 text-sm leading-6 text-slate-400">One-time amounts you need to keep available. This does not pay a bill.</p>
          {!screen.plan.policy && <p className="mt-3 text-sm text-amber-100">Confirm your planning policy first.</p>}
          {staleDraft && <div role="alert" className="mt-4 rounded-xl border border-amber-400/40 p-4 text-sm leading-6 text-amber-100"><p>This commitment changed after you opened it. Your draft is preserved, but it cannot overwrite the newer version.</p><button type="button" disabled={pending} className={`${buttonClass} mt-3`} onClick={() => { const current = screen.plan.commitments.find(row => row.id === editing?.id); setEditing(current?.status !== "removed" ? current ?? null : null); }}>Discard draft and load latest</button></div>}
          <form key={editing ? `${editing.id}:${editing.revision}` : "new-commitment"} className="mt-5" onChange={event => { if (event.target instanceof HTMLInputElement && event.target.name !== "duplicateConfirmed") setDuplicateWarning(false); }} onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
            if (staleDraft) return;
            const fields = { label: data.get("label"), amount: data.get("amount"), dueDate: data.get("dueDate") };
            if (!editing && hasDuplicateCommitment(screen.plan, { label: String(fields.label), amount: String(fields.amount), dueDate: String(fields.dueDate) }) && data.get("duplicateConfirmed") !== "on") { setDuplicateWarning(true); return; }
            mutate(editing ? "updateCommitment" : "createCommitment", editing ? { id: editing.id, ...fields } : fields, () => { form.reset(); setEditing(null); setDuplicateWarning(false); });
          }}>
            <fieldset disabled={!canEdit || !screen.plan.policy} className="space-y-4 disabled:opacity-60">
              <label className="block text-sm">Commitment name<input id="commitment-label" name="label" required maxLength={120} placeholder="Rent, taxes, or an upcoming bill" defaultValue={editing?.label} className={inputClass} /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">Amount (USDC)<input name="amount" inputMode="decimal" pattern={moneyPattern} title="Enter a positive amount with up to two decimal places" maxLength={23} required defaultValue={editing?.amount} className={inputClass} /></label>
                <label className="block text-sm">Due date<input name="dueDate" type="date" min="0001-01-01" max="9999-12-31" required defaultValue={editing?.dueDate} className={`${inputClass} min-w-0 [color-scheme:dark]`} /></label>
              </div>
              {duplicateWarning && !editing && <div className="rounded-xl border border-amber-400/40 p-3 text-sm leading-6 text-amber-100"><p role="alert">A commitment with this name, amount, and due date already exists.</p><label className="mt-3 flex items-start gap-3"><input type="checkbox" name="duplicateConfirmed" required className="mt-1 size-5 shrink-0" /><span>I checked that this is a separate commitment.</span></label></div>}
              <div className="flex flex-wrap gap-3"><button disabled={staleDraft} className={`${buttonClass} border-cyan-300/50 bg-cyan-300/10 text-cyan-100`}>{editing ? "Save commitment" : "Add commitment"}</button>{editing && <button type="button" onClick={() => setEditing(null)} className={buttonClass}>Cancel edit</button>}</div>
            </fieldset>
          </form>
        </section>
      </div>}
      {!overview && <section aria-labelledby="commitment-list-heading" className="rounded-2xl border border-slate-700 p-5">
        <h2 id="commitment-list-heading" className="text-xl font-medium">Your commitments</h2>
        {screen.plan.commitments.length === 0 ? <p className="mt-4 text-sm leading-6 text-slate-400">No commitments yet. Add upcoming bills so this estimate reflects your needs.</p> : <ul className="mt-4 divide-y divide-slate-700">{screen.plan.commitments.map(row => {
          const included = snapshot?.result.includedCommitmentIds.includes(row.id), overdue = row.status === "outstanding" && !!snapshot && row.dueDate < snapshot.input.asOfLocalDate;
          return <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="min-w-0 max-w-full"><h3 className="break-words font-medium">{row.label}</h3><p className="mt-1 break-words text-sm text-slate-400">Due {row.dueDate} · {row.status === "paid" ? "Paid · excluded" : row.status === "removed" ? "Removed · excluded" : included ? `${overdue ? "Overdue · " : ""}Included in plan` : snapshot ? "After this horizon · excluded" : "Awaiting calculation"}</p><p className="mt-2 break-all font-medium tabular-nums">{amount(row.amount)} USDC</p></div>
            <div className="flex flex-wrap gap-2">
              {row.status !== "removed" && <button disabled={!canEdit} type="button" className={buttonClass} aria-label={`Edit ${row.label}`} onClick={() => { setDuplicateWarning(false); setEditing(row); document.getElementById("commitment-heading")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Edit</button>}
              <button disabled={!canEdit} type="button" className={buttonClass} aria-label={`${row.status === "outstanding" ? "Mark paid" : "Restore"} ${row.label}`} onClick={() => mutate("updateCommitment", { id: row.id, status: row.status === "outstanding" ? "paid" : "outstanding" })}>{row.status === "outstanding" ? "Mark paid" : "Restore"}</button>
              {row.status !== "removed" && <button disabled={!canEdit} type="button" className={buttonClass} aria-label={`Remove ${row.label}`} onClick={() => mutate("removeCommitment", { id: row.id })}>Remove</button>}
            </div>
          </li>;
        })}</ul>}
      </section>}
      <section aria-labelledby="hypothetical-heading" className="rounded-2xl border border-slate-700 p-5">
        <h2 id="hypothetical-heading" className="text-xl font-medium">Try a hypothetical amount</h2><p className="mt-2 text-sm leading-6 text-slate-400">See how much room would remain using a refreshed sample. This does not create an order or move funds.</p>
        <form className="mt-4" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("hypothetical"); setPreviewAttempted(true); run(() => previewAmount(screen.scope, value), "Hypothetical preview refreshed. No funds moved."); }}>
          <fieldset disabled={!canEdit || !screen.plan.policy} className="flex flex-wrap items-end gap-3 disabled:opacity-60">
            <label className="block min-w-0 flex-1 text-sm">Hypothetical amount (USDC)<input name="hypothetical" inputMode="decimal" pattern={moneyPattern} title="Enter a positive amount with up to two decimal places" maxLength={23} required className={inputClass} placeholder="100.00" /></label>
            <button className={buttonClass}>Preview amount</button>
          </fieldset>
        </form>
        {previewAttempted && screen.calculationError && <p role="alert" className="mt-4 text-sm text-amber-100">Preview unavailable. Reload the sample and try again. Your saved plan is unchanged.</p>}
        {screen.hypothetical && !expired && <div role="status" className="mt-5 rounded-xl bg-cyan-300/5 p-4 text-sm leading-6 text-cyan-100">
          <p>Before: {amount(screen.hypothetical.before)} USDC of estimated room.</p>
          {screen.hypothetical.after !== null ? <p>After a hypothetical {amount(screen.hypothetical.amount)} USDC: <strong>{amount(screen.hypothetical.after)} USDC</strong> of room would remain.</p> : <p>This amount exceeds the estimated room by <strong>{amount(screen.hypothetical.exceedsBy!)} USDC</strong>. Choose a smaller illustration or review your commitments.</p>}
          <p className="mt-2 text-slate-400">Your commitments and buffer are unchanged.</p>
        </div>}
      </section>
    </>}
  </div>;
}
