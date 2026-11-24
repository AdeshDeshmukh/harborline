import { getAccountPageContext } from "./context.server";

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
    </>
  );
}
