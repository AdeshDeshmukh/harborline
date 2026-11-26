"use client";
import Link from "next/link";
import {useEffect,useRef,useState,useTransition} from "react";
import type {ActivityScreen,ActivityResponse} from "./activity-types";
import {ActivityContent,activityControl} from "./activity-content";
import {activityReloadState} from "./activity-panel-state";
export function ActivityPanel({initial,reload}:{initial:ActivityScreen;reload:()=>Promise<ActivityResponse>}){
 const [state,setState]=useState<{screen:ActivityScreen|null;error:string;locked:boolean}>({screen:initial,error:"",locked:false});
 const [pending,startTransition]=useTransition(),inFlight=useRef(false),notice=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(state.error)notice.current?.focus();},[state.error]);
 function refresh(){
  if(inFlight.current||state.locked)return;
  inFlight.current=true;
  startTransition(async()=>{
   try{setState(activityReloadState(initial,await reload()));}
   catch{setState({screen:null,error:"We could not verify saved activity. Reload to try again.",locked:false});}
   finally{inFlight.current=false;}
  });
 }
 return <>{state.screen?<ActivityContent screen={state.screen}/>:<h1 className="py-8 text-3xl font-semibold">Saved activity unavailable</h1>}
  <div className="flex flex-wrap items-center gap-5"><button type="button" className={activityControl+" disabled:opacity-50"} onClick={refresh} disabled={pending||state.locked}>Reload saved record</button><p role="status" aria-live="polite" className="text-sm text-slate-400">{pending?"Reading saved information…":"Reloading does not contact the trading provider."}</p></div>
  {state.error?<div ref={notice} tabIndex={-1} role="alert" className="mt-5 rounded-2xl border border-rose-300/40 p-5 text-sm leading-7 text-rose-100"><p>{state.error}</p><Link href={state.locked?"/sign-in":"/activity"} prefetch={false} className="mt-3 inline-flex min-h-11 items-center underline">{state.locked?"Open the current account":"Start from activity"}</Link></div>:null}
  <Link href={initial.data.kind==="order"?"/activity":"/plan"} prefetch={false} className="mt-6 inline-flex min-h-11 items-center text-sm text-cyan-200 underline underline-offset-4">{initial.data.kind==="order"?"Back to activity":"Back to your plan"}</Link>
 </>;
}
