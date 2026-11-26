import Link from "next/link";
import { getAccountPageContext } from "../account/context.server";
export const dynamic = "force-dynamic";
export default async function PlanningLayout({ children }: { children: React.ReactNode }) {
  const context = await getAccountPageContext();
  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-8 sm:py-10">
    <div className="mx-auto max-w-5xl">
      <nav aria-label="Main navigation" className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <Link href="/account" className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">Harborline</Link>
        <div className="flex flex-wrap gap-5 text-sm text-slate-300"><Link href="/overview" prefetch={false} className="inline-flex min-h-11 items-center hover:text-cyan-300">Overview</Link><Link href="/plan" prefetch={false} className="inline-flex min-h-11 items-center hover:text-cyan-300">Plan</Link><Link href="/account" prefetch={false} className="inline-flex min-h-11 items-center hover:text-cyan-300">Account</Link><Link href="/activity" prefetch={false} className="inline-flex min-h-11 items-center hover:text-cyan-300">Activity</Link></div>
      </nav>
      {context ? children : <div role="alert" className="py-12"><h1 className="text-3xl font-semibold">Your account is unavailable.</h1><p className="mt-4 text-slate-300">We could not load your plan. Refresh to try again.</p><a href="/plan" className="mt-4 inline-flex min-h-11 items-center text-cyan-300 underline">Try again</a></div>}
      <footer className="mt-12 border-t border-slate-800 pt-6 text-sm text-slate-400"><p>Planning comes first. Deposits and trading are unavailable.</p><form action="/auth/sign-out" method="post" className="mt-3"><button className="min-h-11 underline underline-offset-4">Sign out of this browser</button></form></footer>
    </div>
  </main>;
}
