import "server-only";
import {createActivityController} from "./activity-controller.server";
import type {ActivityResponse} from "./activity-types";
export function createActivityHandlers(deps:{controller?:()=>ReturnType<typeof createActivityController>}={}){
 async function run(request:Request,id?:string){
  if(request.method!=="GET")return json({ok:false,code:"invalid_request",message:"Use GET to read saved activity."},405,{Allow:"GET"});
  const query=new URL(request.url).searchParams;
  if(request.body!==null||[...query.keys()].some(key=>id!==undefined||key!=="cursor")||query.getAll("cursor").length>1||query.has("cursor")&&(!query.get("cursor")||query.get("cursor")!.length>512))return json({ok:false,code:"invalid_request",message:"This activity request is invalid."},400);
  try{
   const controller=(deps.controller??createActivityController)(),result=id===undefined?await controller.list(query.get("cursor")??undefined):await controller.load(id);
   const status=result.ok?200:({unauthenticated:401,session_changed:409,not_found:404,invalid_request:400,unavailable:503} as const)[result.code];return json(result,status);
  }catch{return json({ok:false,code:"unavailable",message:"Saved activity is unavailable."},503);}
 }
 return {list:(request:Request)=>run(request),detail:(request:Request,id:string)=>run(request,id)};
}
function json(body:ActivityResponse,status:number,extra:Record<string,string>={}){return Response.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Expires:"0",...extra}});}
