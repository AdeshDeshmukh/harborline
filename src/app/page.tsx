import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-50">
      <section className="w-full max-w-3xl py-24">
        <p className="mb-6 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
          Harborline
        </p>
        <h1 className="max-w-2xl text-5xl font-semibold tracking-tight sm:text-7xl">
          Invest with room to breathe.
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
          Understand what remains after upcoming commitments and a personal
          buffer, then explicitly approve an investment through True Markets.
        </p>
        <p className="mt-10 text-sm text-slate-400">
          In development. Trading is not available yet.
        </p>
        <Link href="/sign-in" prefetch={false} className="mt-8 inline-flex rounded-xl border border-slate-600 px-5 py-3 text-sm font-medium text-cyan-300 hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">Private pilot sign-in</Link>
      </section>
    </main>
  );
}
