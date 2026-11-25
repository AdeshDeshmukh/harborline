import "server-only";
import { createHash } from "node:crypto";
import { isUuid } from "../../server/env";
import { parseAmount } from "../../features/planning/money";
import type { QuoteContext } from "./quote-types";
import { normalizeDefiQuote } from "./quote-contracts";
import { ReviewError, type Payload, type PreparationObservation } from "../../features/orders/review-types";

export function validateUnsignedPayloads(value: unknown): readonly Payload[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new ReviewError("invalid_terms");
  return Object.freeze(value.map(item => {
    if (!item || typeof item !== "object" || Object.keys(item).length !== 2 || typeof item.payload !== "string" ||
      !item.payload.length || Buffer.byteLength(item.payload) > 131072 || Buffer.from(item.payload).toString("utf8") !== item.payload ||
      typeof item.digest !== "string" || !/^[0-9a-f]{64}$/.test(item.digest) ||
      createHash("sha256").update(item.payload,"utf8").digest("hex") !== item.digest) throw new ReviewError("invalid_terms");
    return Object.freeze({payload:item.payload,digest:item.digest});
  }));
}
export function normalizePreparationResponse(value: unknown, context: QuoteContext): PreparationObservation {
  let providerOrderId: string | null = null;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const row = value as Record<string,unknown>;
    if (typeof row.order_id === "string" && row.order_id.length > 0 && row.order_id.length <= 128 && !/[^A-Za-z0-9_-]/.test(row.order_id)) providerOrderId = row.order_id;
    if (Object.keys(row).some(key=>!["order_id","status","venue","route_reason","payloads","quote"].includes(key))) throw new Error();
    if (row.venue !== "defi" || row.status !== "initialized") return {kind:"incident",reason:"unexpected_execution",providerOrderId};
    const quote = normalizeDefiQuote(row.quote,context);
    if (row.order_id === "" && (row.payloads === undefined || Array.isArray(row.payloads) && row.payloads.length === 0) && quote.issues.length > 0) return {kind:"rejected",reason:"quote_only",providerOrderId:null};
    if (!providerOrderId || quote.issues.length > 0) throw new Error();
    return Object.freeze({kind:"prepared",providerOrderId,quote,payloads:validateUnsignedPayloads(row.payloads)});
  } catch { return Object.freeze({kind:"incident",reason:"invalid_response",providerOrderId}); }
}

export function createOrderPreparationAdapter(transport:{request(method:"POST",path:string,options:{userId:string;body:unknown}):Promise<unknown>}) {
  return {async prepare(input:{source:"contract_fixture"|"provider";providerUserId:string;assetId:string;amount:string}):Promise<unknown>{
    const command={...input};
    if(command.source!=="contract_fixture")throw new ReviewError("integration_unverified");
    if(!isUuid(command.providerUserId)||!isUuid(command.assetId))throw new ReviewError("invalid_request");
    let amount:string;try{amount=parseAmount(parseAmount(command.amount),{scale:6,positive:true});}catch{throw new ReviewError("invalid_request");}
    return transport.request("POST","/v1/gateway/orders",{userId:command.providerUserId,body:{asset_id:command.assetId,qty:amount,qty_unit:"quote",side:"buy",type:"market",chain:"solana",venue:"defi"}});
  }};
}
