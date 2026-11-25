import { getAccountPageContext } from "../../account/context.server";
import { createPlanningController } from "../../../features/planning/screen.server";
import { PlanningWorkspace } from "../../../features/planning/planning-workspace";
export default async function OverviewPage() {
  const context = await getAccountPageContext();
  if (!context) return null;
  const initial = await createPlanningController({ owner: async () => context }).load();
  return <PlanningWorkspace key={context.accountId} scope={context.accountId} initial={initial} overview />;
}
