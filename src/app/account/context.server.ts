import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireOwnerContext, OwnerAccessError, type OwnerContext } from "../../features/identity/access.server";

// React cache deduplicates layout/page work within one RSC render only.
// Route handlers must call requireOwnerContext themselves on each request.
export const getAccountPageContext = cache(async (): Promise<OwnerContext | null> => {
  try { return await requireOwnerContext(); }
  catch (error) {
    if (!(error instanceof OwnerAccessError)) throw error;
    if (error.code === "unauthenticated") redirect("/sign-in");
    return null;
  }
});
