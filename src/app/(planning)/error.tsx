"use client";
export default function PlanningError({ retry }: { retry: () => void }) {
  return <div role="alert" className="py-12"><h1 className="text-3xl font-semibold">Your plan could not be loaded.</h1><p className="mt-4 text-slate-300">Reload the latest plan before making further changes.</p><button onClick={retry} className="mt-6 min-h-11 rounded-xl border border-slate-500 px-5 py-3 focus-visible:outline-2 focus-visible:outline-cyan-300">Try again</button></div>;
}
