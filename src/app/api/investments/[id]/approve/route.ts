import type {NextRequest} from "next/server";
import {approvalHandlers} from "../../../../../features/orders/approval-handlers.server";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
  return approvalHandlers.post(request,(await context.params).id);
}
