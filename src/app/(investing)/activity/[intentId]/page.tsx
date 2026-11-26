import Link from "next/link";
import {getAccountPageContext} from "../../../account/context.server";
import {createActivityController} from "../../../../features/orders/activity-controller.server";
import {ActivityPanel} from "../../../../features/orders/activity-panel";
import {reloadOrder} from "../actions";
export default async function OrderPage({params}:{params:Promise<{intentId:string}>}){
 const context=await getAccountPageContext();
 if(!context)return <div role="alert" className="py-12"><h1 className="text-3xl">Your account is unavailable.</h1><p className="mt-4">We could not verify saved activity.</p></div>;
 const {intentId}=await params,result=await createActivityController({owner:async()=>context}).load(intentId,context.accountId);
 if(!result.ok)return <div role="alert" className="py-12"><h1 className="text-3xl">Order unavailable</h1><p className="mt-4">{result.message}</p><Link href="/activity" className="mt-5 inline-flex min-h-11 items-center text-cyan-200 underline">Return to activity</Link></div>;
 return <ActivityPanel key={context.accountId+intentId+result.screen.serverNow} initial={result.screen} reload={reloadOrder.bind(null,intentId,context.accountId)}/>;
}
