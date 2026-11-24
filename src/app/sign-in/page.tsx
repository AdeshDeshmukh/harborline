import Link from "next/link";
import { redirect } from "next/navigation";
import { loadAuthConfig } from "../../features/identity/config.server";
import { getVerifiedSession } from "../../features/identity/session.server";

export const dynamic = "force-dynamic";
const messages: Record<string, string> = {
  "check-email": "If this email has pilot access, check your inbox for a sign-in link. It may take a few minutes.",
  "invalid-email": "Enter a valid email address and try again.",
  "expired-link": "This link could not be verified. Request a new link in the browser you will use to sign in.",
  "signed-out": "You are signed out of this browser.",
  unavailable: "Sign-in is unavailable right now. Please try again later.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (await getVerifiedSession()) redirect("/account");
  const enabled = Boolean(loadAuthConfig());
  const status = (await searchParams).status;
  const message = status && Object.hasOwn(messages, status) ? messages[status] : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-slate-50">
      <section className="w-full max-w-md">
        <Link href="/" className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">Harborline</Link>
        <h1 className="mt-10 text-4xl font-semibold tracking-tight">Room to breathe.</h1>
        <p className="mt-4 leading-7 text-slate-300">Sign in with your invited email. No password to remember.</p>
        {message && <p role="status" className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm leading-6">{message}</p>}
        {!enabled && <p className="mt-6 rounded-xl border border-slate-700 p-4 text-sm leading-6 text-slate-300">Private pilot sign-in is not available yet. You can still explore Harborline&apos;s public introduction.</p>}
        <form action="/auth/start" method="post" className="mt-8 space-y-4">
          <label htmlFor="email" className="block text-sm font-medium">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} disabled={!enabled}
            className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/30 disabled:opacity-50" />
          <button type="submit" disabled={!enabled} className="w-full rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">Email a sign-in link</button>
        </form>
        <p className="mt-6 text-sm leading-6 text-slate-400">Signing in verifies your identity. Investment access requires separate eligibility checks.</p>
        <Link href="/" className="mt-8 inline-block text-sm text-cyan-300 underline underline-offset-4">Back to Harborline</Link>
      </section>
    </main>
  );
}
