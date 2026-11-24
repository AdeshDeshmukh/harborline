import Link from "next/link";
import { getAccountPageContext } from "../context.server";

export const dynamic = "force-dynamic";
export default async function AccountSetup() {
  if (!await getAccountPageContext()) return null;
  return (
    <>
      <h1 className="mt-10 text-4xl font-semibold tracking-tight">Investment setup is not available yet.</h1>
      <p className="mt-6 leading-7 text-slate-300">Your Harborline profile is ready. Wallet setup will open after access and recovery checks are complete.</p>
      <p className="mt-4 leading-7 text-slate-300">You don&apos;t need to deposit funds or share a private key. Deposits and trading are unavailable.</p>
      <Link href="/account" className="mt-6 inline-block text-cyan-300 underline underline-offset-4">Back to your account</Link>
    </>
  );
}
