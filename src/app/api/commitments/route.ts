import { planningHandlers } from "../../../features/planning/handlers.server";
export const dynamic = "force-dynamic";
export const POST = planningHandlers.createCommitment;
export const PATCH = planningHandlers.updateCommitment;
export const DELETE = planningHandlers.removeCommitment;
