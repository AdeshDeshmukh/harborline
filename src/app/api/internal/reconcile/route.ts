import { reconciliationHandler } from "../../../../features/orders/worker-handler.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return reconciliationHandler(request); }
export async function HEAD(request: Request) { return reconciliationHandler(request); }
