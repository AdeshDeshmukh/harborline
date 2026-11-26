import "server-only";
import {isUuid} from "../../server/env";
import {ActivityError} from "./activity-types";
type Cursor={v:1;accountId:string;at:string;id:string};
export function encodeActivityCursor(value:Cursor){return Buffer.from(JSON.stringify(value)).toString("base64url");}
export function decodeActivityCursor(value:string,accountId:string):Cursor{
 try{
  if(typeof value!=="string"||value.length>512||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
  const r=JSON.parse(Buffer.from(value,"base64url").toString("utf8"));
  if(!r||Object.keys(r).sort().join(",")!=="accountId,at,id,v"||r.v!==1||r.accountId!==accountId||!isUuid(r.id)||typeof r.at!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(r.at)||!Number.isFinite(Date.parse(r.at))||new Date(r.at).toISOString()!==r.at.slice(0,23)+"Z"||encodeActivityCursor(r)!==value)throw new Error();
  return r;
 }catch{throw new ActivityError("invalid_request");}
}
