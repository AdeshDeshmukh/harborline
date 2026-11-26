import type {SaleReadTicket,SaleWalletEvidence} from "./disposal-store-types";
import {fixture,normalizeDisposalBalance,record} from "./disposal-validation";
export function normalizeSaleWallet(value:unknown,binding:SaleReadTicket["binding"]):SaleWalletEvidence {
 const r=record(value,["source","holding","cash"]);fixture(r.source);
 return Object.freeze({source:"contract_fixture",holding:normalizeDisposalBalance(r.holding,binding,"stock"),cash:normalizeDisposalBalance(r.cash,binding,"cash")});
}
