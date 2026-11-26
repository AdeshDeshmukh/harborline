import type {ActivityResponse,ActivityScreen} from "./activity-types";
export function activityReloadState(previous:ActivityScreen,response:ActivityResponse):{screen:ActivityScreen|null;error:string;locked:boolean}{
 if(response.ok){
  if(response.screen.scope!==previous.scope||response.screen.sample!==previous.sample||response.screen.data.kind!==previous.data.kind||response.screen.data.kind==="order"&&previous.data.kind==="order"&&response.screen.data.order.id!==previous.data.order.id)return {screen:null,error:"The signed-in account or saved record changed. Open activity again.",locked:true};
  return {screen:response.screen,error:"",locked:false};
 }
 return {screen:null,error:response.message,locked:response.code==="session_changed"||response.code==="unauthenticated"};
}
