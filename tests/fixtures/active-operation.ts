import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
// Seed a real owned intent for pre-existing planning lock tests. Never call a provider.
export async function seedActiveOperation(admin:Pool,accountId:string){
 const intentId=randomUUID(),client=await admin.connect();
 try{await client.query("BEGIN");await client.query(`INSERT INTO harborline.investment_intents
  (id,account_id,operation_kind,asset_id,requested_qty,qty_unit,policy_revision,request_key,request_hash)
  SELECT $1,id,'exit',$2,1,'base',policy_revision,$3,repeat('0',64) FROM harborline.gateway_accounts WHERE id=$4`,[intentId,randomUUID(),randomUUID(),accountId]);
  await client.query("UPDATE harborline.gateway_accounts SET active_operation_id=$1 WHERE id=$2",[intentId,accountId]);await client.query("COMMIT");return intentId;
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
