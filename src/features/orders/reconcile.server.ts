import "server-only";
import type { OwnerContext } from "../identity/access.server";
import { RecoveryError, type RecoveryReadResult, type RecoveryView } from "./recovery-types";
import type { createRecoveryRepository } from "./recovery-repository.server";
import type { createOrderRecoveryAdapter } from "../../integrations/truemarkets/recovery.server";
export function createOrderReconciler(options: {
  source?: "contract_fixture" | "provider";
  repository: ReturnType<typeof createRecoveryRepository>;
  adapter: ReturnType<typeof createOrderRecoveryAdapter>;
}) {
  return {
    async reconcileOrder(context: OwnerContext, intentId: string, control: {signal?:AbortSignal} = {}): Promise<RecoveryView> {
      if (options.source !== "contract_fixture")
        throw new RecoveryError("disabled");
      const signal=control.signal;
      if(signal?.aborted)throw new RecoveryError("unavailable");
      // Durable ticket first; no transaction or account lock across the GET.
      const ticket = await options.repository.begin(context, intentId);
      if(signal?.aborted)throw new RecoveryError("unavailable");
      let result: RecoveryReadResult;
      try {
        result = await options.adapter.read({ providerUserId: ticket.providerUserId, providerOrderId: ticket.providerOrderId, ...(signal?{signal}:{}) });
      }
      catch (error) {
        // Adapter transport failures are already bounded read results. A rejected
        // composition/input is not a provider observation and must not become one.
        throw error instanceof RecoveryError ? error : new RecoveryError("unavailable");
      }
      if(signal?.aborted)throw new RecoveryError("unavailable");
      return options.repository.record(context, ticket.id, result);
    },
  };
}
