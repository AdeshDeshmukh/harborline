import {notFound} from "next/navigation";
import {ActivityContent} from "../../../../../features/orders/activity-content";
import {sampleActivity,activityScenarios} from "../../../../../features/orders/sample-activity.server";
export default async function SampleOrderPage({params}:{params:Promise<{scenario:string}>}){
 const {scenario}=await params;
 if(scenario!=="empty"&&!activityScenarios.some(name=>name===scenario))notFound();
 return <ActivityContent screen={sampleActivity(scenario)}/>;
}
