import "server-only";
import type {OwnerContext} from "../identity/access.server";
import {ApprovalError} from "./approval-types";
import {normalizeApprovalCommand} from "./approval-command";
import type {createExecutionRepository} from "./execution-repository.server";
import type {createReviewVault} from "./review-vault.server";
import type {createOwnedSigner} from "../accounts/signer.server";
import type {createOrderExecutionAdapter} from "../../integrations/truemarkets/execution.server";
import type {createApprovalRepository} from "./approvals.server";
import {createFixtureApprovalService} from "./approve.server";
type Options={source?:"contract_fixture"|"provider";execution:ReturnType<typeof createExecutionRepository>;vault:ReturnType<typeof createReviewVault>;signer:ReturnType<typeof createOwnedSigner>;adapter:ReturnType<typeof createOrderExecutionAdapter>};
export function createFixtureExecutionService(options:Options){
  return {async execute(context:OwnerContext,value:unknown):Promise<void>{
    if(options.source!=="contract_fixture")throw new ApprovalError("disabled");
    const command=normalizeApprovalCommand(value),work=await options.execution.claim(context,command);
    if(!work)return;
    try{
      const payloads=options.vault.open(work.binding,work.termsHash,work.sealed);
      if(payloads.length!==work.payloadHashes.length||payloads.some((p,i)=>p.digest!==work.payloadHashes[i]))throw new ApprovalError("conflict");
      const signatures=await options.signer.stamp(context,work.publicKey,payloads);
      if(signatures.length!==payloads.length)throw new ApprovalError("conflict");
      const current=await options.execution.authorizeSend(context,command,work.attemptId);
      if(current.publicKey!==work.publicKey||current.providerUserId!==work.providerUserId||current.providerOrderId!==work.providerOrderId)throw new ApprovalError("conflict");
      const status=await options.adapter.execute({source:"contract_fixture",providerUserId:work.providerUserId,providerOrderId:work.providerOrderId,signatures,assertCurrent:current.assertFresh});
      await options.execution.finish(context,command,work.attemptId,status);
    }catch{
      try{await options.execution.finish(context,command,work.attemptId,null);}catch{throw new ApprovalError("unavailable");}
    }
  }};
}
export function createSignedApprovalService(options:Options&{approvals:ReturnType<typeof createApprovalRepository>;refreshFixtureEvidence:(ctx:OwnerContext)=>Promise<unknown>}){
  const executor=createFixtureExecutionService(options);
  return {async approve(ctx:OwnerContext,value:unknown){
    const command=normalizeApprovalCommand(value);
    const service=createFixtureApprovalService({source:options.source,approvals:options.approvals,refreshFixtureEvidence:options.refreshFixtureEvidence,fixtureExecutor:()=>executor.execute(ctx,command)});
    const result=await service.approve(ctx,command);
    return Object.freeze({...result,state:await options.execution.current(ctx,command)});
  }};
}
