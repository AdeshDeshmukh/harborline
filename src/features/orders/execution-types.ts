import type {OwnerContext} from "../identity/access.server";
import type {VaultBinding} from "./review-vault.server";
import type {SealedPayloads} from "./review-types";
export type ExecutionStatus="complete"|"pending"|"failed"|"canceled"|null;
export type ExecutionWork=Readonly<{attemptId:string;intentId:string;termsHash:string;providerOrderId:string;providerUserId:string;publicKey:string;binding:VaultBinding;payloadHashes:readonly string[];sealed:SealedPayloads}>;
/** Shared claim/decrypt/sign/revalidate/send/finish protocol, not a live adapter. */
export type ExecutionPort={
 claim:(ctx:OwnerContext,value:unknown)=>Promise<ExecutionWork|null>;
 authorizeSend:(ctx:OwnerContext,value:unknown,attemptId:string)=>Promise<{providerOrderId:string;providerUserId:string;publicKey:string;assertFresh:()=>void}>;
 finish:(ctx:OwnerContext,value:unknown,attemptId:string,status:ExecutionStatus)=>Promise<void>;
 current:(ctx:OwnerContext,value:unknown)=>Promise<string>;
};
