"use server";
import {createActivityController} from "../../../features/orders/activity-controller.server";
export async function reloadActivity(cursor:string|undefined,scope:string){return createActivityController().list(cursor,scope);}
export async function reloadOrder(intentId:string,scope:string){return createActivityController().load(intentId,scope);}
