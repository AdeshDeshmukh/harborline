import Link from "next/link";
import { getAccountPageContext } from "./context.server";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const context = await getAccountPageContext();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-slate-50">
      <section className="w-full max-w-lg">
        <Link href="/" className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">Harborline</Link>
        {context ? children : <div role="status">
          <h1 className="mt-10 text-4xl font-semibold tracking-tight">Your account is unavailable.</h1>
          <p className="mt-6 leading-7 text-slate-300">We couldn&apos;t load your account. Refresh to try again, or sign out below.</p>
          <a href="/account" className="mt-6 inline-block text-cyan-300 underline underline-offset-4">Try again</a>
        </div>}
        <form action="/auth/sign-out" method="post" className="mt-8">
          <button className="rounded-xl border border-slate-500 px-5 py-3 font-medium hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">Sign out of this browser</button>
        </form>
      </section>
    </main>
  );
}
