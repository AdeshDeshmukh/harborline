import {expect,test} from "vitest";
import {projectActualEvidence} from "../src/features/orders/activity-projection";
import {ActivityError} from "../src/features/orders/activity-types";
const at="2026-11-25T12:00:00.000Z";
test("actual projection keeps missing fields unknown and drops private/link metadata",()=>{
 expect(projectActualEvidence({providerStatus:"complete",filledBase:null,remainingBase:"0",feeQuote:null,averagePriceQuote:null,partial:null,explorer_url:"javascript:secret",payloads:["secret"]},at)).toEqual({providerStatus:"complete",filledBase:null,remainingBase:"0",feeQuote:null,averagePriceQuote:null,partial:null,recordedAt:at});
});
test.each([{providerStatus:"made_up"},{filledBase:"-1"},{feeQuote:{secret:"value"}},{providerStatus:"complete",filledBase:"0"}])("malformed stored actual data rejects without leaking it: %j",fields=>{
 expect(()=>projectActualEvidence({providerStatus:"pending",filledBase:"0.2",remainingBase:"0.3",feeQuote:"0.2",averagePriceQuote:"200",...fields},at)).toThrow(ActivityError);
});
test("partial fills are derived from exact base quantities rather than a quote-unit request",()=>{
 expect(projectActualEvidence({providerStatus:"failed",filledBase:"0.2",remainingBase:"0.3",feeQuote:"0.2",averagePriceQuote:"200",partial:false},at)).toMatchObject({partial:true,filledBase:"0.2"});
});
