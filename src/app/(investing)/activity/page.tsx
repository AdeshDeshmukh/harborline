import Link from "next/link";
import {getAccountPageContext} from "../../account/context.server";
import {createActivityController} from "../../../features/orders/activity-controller.server";
import {ActivityPanel} from "../../../features/orders/activity-panel";
import {reloadActivity} from "./actions";
export default async function ActivityPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const context=await getAccountPageContext();
 if(!context)return <div role="alert" className="py-12"><h1 className="text-3xl">Your account is unavailable.</h1><p className="mt-4">We could not verify saved activity.</p></div>;
 const query=await searchParams,cursor=query.cursor;
 if(Object.keys(query).some(key=>key!=="cursor")||Array.isArray(cursor))return <div role="alert" className="py-12"><h1 className="text-3xl">Activity page unavailable</h1><Link href="/activity" className="mt-5 inline-flex min-h-11 items-center text-cyan-200 underline">Start from activity</Link></div>;
 const result=await createActivityController({owner:async()=>context}).list(cursor,context.accountId);
 if(!result.ok)return <div role="alert" className="py-12"><h1 className="text-3xl">Activity unavailable</h1><p className="mt-4">{result.message}</p><Link href="/activity" className="mt-5 inline-flex min-h-11 items-center text-cyan-200 underline">Start from activity</Link></div>;
 return <ActivityPanel key={context.accountId+result.screen.serverNow} initial={result.screen} reload={reloadActivity.bind(null,cursor,context.accountId)}/>;
}
