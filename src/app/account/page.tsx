import { getAccountPageContext } from "./context.server";
import Link from "next/link";

export const dynamic = "force-dynamic";
export default async function Account() {
  // The page enforces its own data boundary: a layout alone is not authorization.
  const context = await getAccountPageContext();
  if (!context) return null;
  return (
    <>
      <h1 className="mt-10 text-4xl font-semibold tracking-tight">You&apos;re signed in.</h1>
      <p className="mt-4 break-all text-slate-300">{context.email}</p>
      <p className="mt-6 leading-7 text-slate-300">Your Harborline profile is ready. Investment access requires separate eligibility checks. Deposits and trading are not available.</p>
      <Link href="/plan" prefetch={false} className="mt-6 mr-6 inline-block text-cyan-300 underline underline-offset-4">Build your cash plan</Link>
      <Link href="/overview" prefetch={false} className="mt-6 mr-6 inline-block text-cyan-300 underline underline-offset-4">View overview</Link>
      <Link href="/account/setup" prefetch={false} className="mt-6 inline-block text-cyan-300 underline underline-offset-4">View investment setup</Link>
    </>
  );
}
