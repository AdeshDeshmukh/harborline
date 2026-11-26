import "server-only";
import { RecoveryError, type RecoveryReadResult } from "../../features/orders/recovery-types";
import { isUuid } from "../../server/env";
export function createOrderRecoveryAdapter(transport: {
  request(method: "GET", path: string, options: {
    userId: string;
  }): Promise<unknown>;
}, source?: "contract_fixture" | "provider") {
  return {
    async read(input: {
      providerUserId: string;
      providerOrderId: string;
    }): Promise<RecoveryReadResult> {
      if (source !== "contract_fixture")
        throw new RecoveryError("disabled");
      const c = { ...input };
      if (!isUuid(c.providerUserId) || typeof c.providerOrderId !== "string" || !c.providerOrderId.length || c.providerOrderId.length > 128 || /[^A-Za-z0-9_-]/.test(c.providerOrderId))
        throw new RecoveryError("invalid_request");
      try {
        return { source: "contract_fixture", kind: "response", body: await transport.request("GET", `/v1/gateway/orders/${c.providerOrderId}`, { userId: c.providerUserId }) };
      }
      catch (error) {
        return { source: "contract_fixture", kind: error && typeof error === "object" && "status" in error && error.status === 404 ? "not_found" : "unavailable" };
      }
    },
  };
}
