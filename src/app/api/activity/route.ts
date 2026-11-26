import {createActivityHandlers} from "../../../features/orders/activity-handlers.server";
export const dynamic="force-dynamic";
export async function GET(request:Request){return createActivityHandlers().list(request);}
