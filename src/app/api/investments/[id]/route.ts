import {createActivityHandlers} from "../../../../features/orders/activity-handlers.server";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return createActivityHandlers().detail(request,(await params).id);}
