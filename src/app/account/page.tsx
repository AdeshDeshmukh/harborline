import Link from "next/link";
import { redirect } from "next/navigation";
import { getVerifiedSession } from "../../features/identity/session.server";

export const dynamic = "force-dynamic";
export default async function Account() {
  const identity = await getVerifiedSession();
  if (!identity) redirect("/sign-in");
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-slate-50">
      <section className="w-full max-w-lg">
        <Link href="/" className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">Harborline</Link>
        <h1 className="mt-10 text-4xl font-semibold tracking-tight">You&apos;re signed in.</h1>
        <p className="mt-4 break-all text-slate-300">{identity.email}</p>
        <p className="mt-6 leading-7 text-slate-300">Your email is verified. Private pilot access is being prepared; deposits and trading are not available.</p>
        <form action="/auth/sign-out" method="post" className="mt-8">
          <button className="rounded-xl border border-slate-500 px-5 py-3 font-medium hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">Sign out of this browser</button>
        </form>
      </section>
    </main>
  );
}
