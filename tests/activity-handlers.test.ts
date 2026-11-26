import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createActivityHandlers} from "../src/features/orders/activity-handlers.server";
const unavailable={ok:false as const,code:"unauthenticated" as const,message:"Sign in"};
function fixture(){const list=vi.fn(async()=>unavailable),load=vi.fn(async()=>unavailable);return {list,load,api:createActivityHandlers({controller:()=>({list,load})})};}
test("GET activity forwards only a single bounded cursor and sends no-store on auth failure",async()=>{
 const d=fixture(),r=await d.api.list(new Request("http://localhost/api/activity?cursor=abc"));
 expect(d.list).toHaveBeenCalledWith("abc");expect(r.status).toBe(401);expect(r.headers.get("cache-control")).toContain("private, no-store");
});
test.each(["?owner=other","?cursor=a&cursor=b","?limit=100","?cursor=" ,"?cursor="+"a".repeat(513)])("unsupported selectors never reach the reader: %s",async query=>{
 const d=fixture(),r=await d.api.list(new Request("http://localhost/api/activity"+query));expect(r.status).toBe(400);expect(d.list).not.toHaveBeenCalled();
});
test("GET detail accepts no selectors and non-GET never calls a controller",async()=>{
 const d=fixture();expect((await d.api.detail(new Request("http://localhost/api/investments/x?owner=a"),"x")).status).toBe(400);
 expect((await d.api.list(new Request("http://localhost/api/activity",{method:"POST",body:"secret"}))).status).toBe(405);expect(d.list).not.toHaveBeenCalled();expect(d.load).not.toHaveBeenCalled();
});
test("unconfigured defaults do not contact a provider or leak configuration",async()=>{
 const r=await createActivityHandlers().list(new Request("http://localhost/api/activity"));expect([401,503]).toContain(r.status);expect(JSON.stringify(await r.json())).not.toMatch(/DATABASE_URL|postgresql|private_key/);
});
