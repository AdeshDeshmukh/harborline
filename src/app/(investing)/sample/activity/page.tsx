import {ActivityContent} from "../../../../features/orders/activity-content";
import {sampleActivity} from "../../../../features/orders/sample-activity.server";
export default function SampleActivityPage(){return <ActivityContent screen={sampleActivity("list")}/>;}
