import "server-only";
import {OwnerAccessError,requireOwnerContext} from "../identity/access.server";
import {createActivityReader} from "./activity-reader.server";
import {ActivityError,type ActivityResponse,type ActivityScreen} from "./activity-types";
export function createActivityController(deps:{owner?:typeof requireOwnerContext;reader?:()=>ReturnType<typeof createActivityReader>;clock?:()=>Date}={}){
 async function run(kind:"list"|"order",value?:string,scope?:string):Promise<ActivityResponse>{
  try{
   const context=await (deps.owner??requireOwnerContext)();
   if(scope!==undefined&&scope!==context.accountId)return {ok:false,code:"session_changed",message:"The signed-in account changed. Open activity from your current account."};
   const reader=(deps.reader??createActivityReader)();
   const data:ActivityScreen["data"]=kind==="list"?{kind:"list",page:await reader.list(context,value)}:{kind:"order",order:await reader.load(context,value!)};
   return {ok:true,screen:{scope:context.accountId,serverNow:(deps.clock??(()=>new Date()))().toISOString(),sample:false,data}};
  }catch(error){
   if(error instanceof OwnerAccessError&&error.code==="unauthenticated")return {ok:false,code:"unauthenticated",message:"Your session ended. Sign in again to view saved activity."};
   if(error instanceof ActivityError&&error.code==="not_found")return {ok:false,code:"not_found",message:"This order could not be found in your account."};
   if(error instanceof ActivityError&&error.code==="invalid_request")return {ok:false,code:"invalid_request",message:"This activity page could not be opened. Start again from activity."};
   return {ok:false,code:"unavailable",message:"We could not verify saved activity. Reload to try again."};
  }
 }
 return {list:(cursor?:string,scope?:string)=>run("list",cursor,scope),load:(id:string,scope?:string)=>run("order",id,scope)};
}
