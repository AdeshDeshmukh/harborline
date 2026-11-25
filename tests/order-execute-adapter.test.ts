import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createOrderExecutionAdapter} from "../src/integrations/truemarkets/execution.server";
const command={source:"contract_fixture" as const,providerUserId:"33333333-3333-4333-8333-333333333333",providerOrderId:"fixture_order_1",signatures:["fixtureStamp"],assertCurrent:()=>{}};
test("execute sends one ordered signature list and only normalizes bounded status",async()=>{
 let calls=0,seen:unknown;
 const adapter=createOrderExecutionAdapter({async request(method,path,options){calls++;seen={method,path,...options};return {status:"complete",secret:"must not serialize"};}});
 expect(await adapter.execute(command)).toBe("complete");expect(calls).toBe(1);
 expect(seen).toEqual({method:"POST",path:"/v1/gateway/orders/fixture_order_1/execute",userId:command.providerUserId,body:{auth_type:"api_key",signatures:["fixtureStamp"]}});
});
test("an ambiguous execute is never retried",async()=>{
 let calls=0;const adapter=createOrderExecutionAdapter({async request(){calls++;throw new Error("private response");}});
 await expect(adapter.execute(command)).rejects.toThrow();expect(calls).toBe(1);
});
test("provider mode is blocked before dispatch",async()=>{
 let calls=0;const adapter=createOrderExecutionAdapter({async request(){calls++;return {status:"complete"};}});
 await expect(adapter.execute({...command,source:"provider"})).rejects.toMatchObject({code:"disabled"});expect(calls).toBe(0);
});
