"use server";
import { createReviewScreenController } from "../../../../features/orders/screen.server";
export async function reloadReview(intentId:string,scope:string){return createReviewScreenController().load(intentId,scope);}
