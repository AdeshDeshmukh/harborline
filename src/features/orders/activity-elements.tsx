import {exactDisplayAmount} from "./review-screen";
export const card="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 sm:p-7";
function date(value:string){return new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"medium",timeZone:"UTC"}).format(new Date(value))+" UTC";}
export function RecordedTime({at}:{at:string}){return <time dateTime={at}>{date(at)}</time>;}
export function Amount({value,unit}:{value:string|null;unit:string}){return <span className="tabular-nums">{value===null?"Not recorded":exactDisplayAmount(value)+" "+unit}</span>;}
export function Rows({rows}:{rows:readonly (readonly [string,React.ReactNode])[]}){return <dl className="mt-5 divide-y divide-slate-800">{rows.map(([label,value])=><div key={label} className="grid gap-2 py-3 text-sm sm:grid-cols-2 sm:gap-6"><dt className="text-slate-400">{label}</dt><dd className="min-w-0 break-words text-slate-100 sm:text-right">{value}</dd></div>)}</dl>;}
