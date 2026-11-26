import "server-only";
import type { OwnerContext } from "../identity/access.server";
import type { createSettlementRepository } from "./settlement-repository.server";
import { MaintenanceError, maintenanceTime } from "./maintenance-types";
export function createSettlementObserver(options: {
  source?: "contract_fixture" | "provider";
  repository: ReturnType<typeof createSettlementRepository>;
  clock: () => Date;
  transport: {
    request(method: "GET", path: string, options: {
      userId: string;
      signal?: AbortSignal;
    }): Promise<unknown>;
  };
}) {
  return { async observe(ctx: OwnerContext, intentId: string, signal?: AbortSignal) {
      if (options.source !== "contract_fixture")
        throw new MaintenanceError("disabled");
      const active = () => {
        if (signal?.aborted)
          throw new MaintenanceError("unavailable");
      };
      active();
      const basis = await options.repository.beginBalanceRead(ctx, intentId);
      active();
      const observedAt = basis.balanceStartedAt;
      const age = maintenanceTime(options.clock).getTime() - Date.parse(observedAt);
      if (age < 0 || age > 15000)
        throw new MaintenanceError("conflict");
      let body: unknown;
      try {
        body = await options.transport.request("GET", "/v1/gateway/balances", { userId: basis.providerUserId, ...(signal ? { signal } : {}) });
      }
      catch {
        throw new MaintenanceError("unavailable");
      }
      active();
      return options.repository.recordBalance(ctx, basis, { source: "contract_fixture", observedAt, body });
    } };
}
