"use server";
import { headers } from "next/headers";
import { loadAuthConfig } from "../../features/identity/config.server";
import { createPlanningController } from "../../features/planning/screen.server";
import type { PlanningResponse } from "../../features/planning/screen-types";
async function allowed() {
  const config = loadAuthConfig();
  return !!config && (await headers()).get("origin") === config.appOrigin;
}
const denied: PlanningResponse = { ok: false, code: "invalid_origin", message: "This request could not be accepted. Reload your plan.", reloadRequired: true };
export async function refreshPlan(scope: unknown): Promise<PlanningResponse> {
  if (!await allowed()) return denied;
  return createPlanningController().refresh(scope);
}
export async function changePlan(scope: unknown, kind: unknown, input: unknown): Promise<PlanningResponse> {
  if (!await allowed()) return denied;
  return createPlanningController().mutate(scope, kind, input);
}
export async function previewAmount(scope: unknown, amount: unknown): Promise<PlanningResponse> {
  if (!await allowed()) return denied;
  return createPlanningController().preview(scope, amount);
}
