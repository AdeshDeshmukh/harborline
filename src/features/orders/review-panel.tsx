"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ReviewContent, reviewStatusCopy } from "./review-content";
import { reviewStatusAt } from "./review-screen";
import type { ReviewScreen, ReviewScreenResponse } from "./screen-types";

const control="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-500 px-4 py-3 text-sm font-medium text-cyan-200 hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300";
export function ReviewPanel({initial,reload}:{initial:ReviewScreen;reload?:(intentId:string,scope:string)=>Promise<ReviewScreenResponse>}){
  const [screen,setScreen]=useState(initial),[error,setError]=useState(""),[sessionChanged,setSessionChanged]=useState(false),[pending,startTransition]=useTransition();
  const [clock,setClock]=useState({basis:initial.serverNow,now:Date.parse(initial.serverNow)});
  const notice=useRef<HTMLDivElement>(null),locked=useRef(false);
  useEffect(()=>{
    if(!screen.review)return;
    const start=performance.now(),serverTime=Date.parse(screen.serverNow);
    const timer=setInterval(()=>{
      const time=Math.max(serverTime+performance.now()-start,Date.now());
      setClock(previous=>({basis:screen.serverNow,now:Math.max(time,previous.basis===screen.serverNow?previous.now:serverTime)}));
    },1000);
    return ()=>clearInterval(timer);
  },[screen.serverNow,screen.status,screen.review]);
  useEffect(()=>{if(error)notice.current?.focus();},[error]);
  const now=clock.basis===screen.serverNow?clock.now:Date.parse(screen.serverNow),status=reviewStatusAt(screen,now);
  const seconds=screen.review?Math.max(0,Math.floor((Date.parse(screen.review.localExpiresAt)-now)/1000)):null;
  const age=screen.review?Math.max(0,Math.floor((now-Date.parse(screen.review.quote.observedAt))/1000)):null;
  async function refresh(){
    if(!reload||locked.current||sessionChanged)return;
    locked.current=true;
    startTransition(async()=>{
      try{
        const result=await reload(screen.intentId,screen.scope);
        if(result.ok){setScreen(result.screen);setError("");}
        else{setError(result.message);setSessionChanged(result.code==="session_changed"||result.code==="unauthenticated");setScreen(previous=>({...previous,review:null,status:"unavailable"}));}
      }catch{setError("We could not verify the saved record. Reload before making a decision.");setScreen(previous=>({...previous,review:null,status:"unavailable"}));}
      finally{locked.current=false;}
    });
  }
  return <>
    <ReviewContent screen={screen} status={status}/>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
      <div><p role="status" aria-live="polite" className="text-sm text-amber-100">{pending?"Checking the saved record…":reviewStatusCopy[status].title}</p>{age!==null?<p aria-live="off" className="mt-1 text-xs tabular-nums text-slate-400">{"Quote age: "+age+" seconds"}</p>:null}{seconds!==null&&status==="current"?<p aria-live="off" className="mt-1 text-xs tabular-nums text-slate-400">About {seconds}s left in this local illustration. Approval remains unavailable.</p>:null}</div>
      {screen.sample?<Link href="/sample/review" prefetch={false} className={control}>Restart illustration</Link>:<button type="button" onClick={refresh} disabled={pending||sessionChanged||!reload} className={control+" disabled:opacity-50"}>Reload saved terms</button>}
    </div>
    {error?<div ref={notice} tabIndex={-1} role="alert" className="mt-5 rounded-2xl border border-rose-300/40 p-4 text-sm leading-6 text-rose-100"><p>{error}</p>{sessionChanged?<Link href="/sign-in" prefetch={false} className="mt-3 inline-flex min-h-11 items-center underline">Open the current account</Link>:null}</div>:null}
    <div className="mt-7 flex flex-wrap gap-5 text-sm"><Link href={screen.sample?"/sample/asset":"/plan"} prefetch={false} className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4">{screen.sample?"Back to the sample asset":"Back to your plan"}</Link>{screen.sample?<><Link href="/sample/review?state=expired" prefetch={false} className="inline-flex min-h-11 items-center text-slate-300 underline">Expired example</Link><Link href="/sample/review?state=changed" prefetch={false} className="inline-flex min-h-11 items-center text-slate-300 underline">Changed-plan example</Link><Link href="/sample/review?state=unavailable" prefetch={false} className="inline-flex min-h-11 items-center text-slate-300 underline">Unavailable example</Link></>:null}</div>
  </>;
}
