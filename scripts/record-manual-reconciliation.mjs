import {constants} from "node:fs";
import {open} from "node:fs/promises";
import {pathToFileURL} from "node:url";
/**
 * Runtime composition is deliberately absent. Only an explicit fixture caller
 * can bind the owned repository's configured operator action for local tests.
 * @param {string[]} args
 * @param {{source?:string,run:(proof:unknown)=>Promise<unknown>}} [options]
 * @returns {Promise<{exitCode:number,message:string}>}
 */
export async function runManualCommand(args,options){
 if(options?.source!=="contract_fixture"||typeof options.run!=="function")return {exitCode:1,message:"Manual reconciliation is disabled; no changes were made."};
 if(args.length!==2||args[0]!=="--proof-file"||!args[1])return {exitCode:1,message:"Provide one proof file."};
 try{
  const file=await open(args[1],constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  let proof;
  try{
   const stat=await file.stat();if(!stat.isFile()||stat.size>4096)throw new Error();
   const data=Buffer.alloc(4097);let used=0;
   while(used<data.length){const {bytesRead}=await file.read(data,used,data.length-used,used);if(bytesRead===0)break;used+=bytesRead;}
   if(used>4096)throw new Error();proof=JSON.parse(data.subarray(0,used).toString("utf8"));
  }finally{await file.close();}
  const result=await options.run(proof);
  if(!result||typeof result!=="object")throw new Error();
  const value=/** @type {Record<string,unknown>} */(result);
  if(typeof value.id!=="string"||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)||value.method!=="manual"||value.source!=="contract_fixture"||value.slotReleased!==true)throw new Error();
  return {exitCode:0,message:"Recorded fixture manual verification "+value.id};
 }catch{return {exitCode:1,message:"Manual reconciliation could not be verified; inspect the owned evidence."};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await runManualCommand(process.argv.slice(2));if(result.exitCode===0)console.log(result.message);else console.error(result.message);process.exitCode=result.exitCode;}
