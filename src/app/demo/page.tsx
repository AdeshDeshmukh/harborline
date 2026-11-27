import Link from "next/link";
import { DemoWorkspace } from "../../features/demo/demo-workspace";
import { createDemoFixtures } from "../../features/demo/demo-fixtures.server";
import { ActivityContent } from "../../features/orders/activity-content";
import { ReviewContent } from "../../features/orders/review-content";

export const metadata = { title: "Sample walkthrough | Harborline" };

export default function DemoPage() {
  const { current, changed, expired, rejected, unknown, verified } = createDemoFixtures();

  return (
    <main className="investment-ui min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <a href="#walkthrough" className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center focus:text-cyan-200">Skip to walkthrough</a>
        <header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-b border-slate-800 pb-4">
          <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">Harborline</Link>
          <p className="text-sm font-medium text-amber-200">Sample walkthrough · no real funds</p>
        </header>
        <DemoWorkspace views={{
          current: <ReviewContent screen={current} embedded />,
          changed: <ReviewContent screen={changed} embedded />,
          expired: <ReviewContent screen={expired} embedded />,
          rejected: (
            <section className="rounded-2xl border border-amber-300/30 bg-slate-900 p-5 sm:p-7">
              <h2 className="text-lg font-semibold">This quote cannot be accepted</h2>
              <p className="mt-3 leading-7 text-slate-300">The example quote carried a price impact warning. The preparation result was {rejected.kind} before an order was created.</p>
              <p className="mt-3 font-medium text-amber-200">No order to approve or track.</p>
            </section>
          ),
          unknown: <ActivityContent screen={unknown} embedded />,
          verified: <ActivityContent screen={verified} embedded />,
        }} />
      </div>
    </main>
  );
}
