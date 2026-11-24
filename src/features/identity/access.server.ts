import "server-only";
import { bootstrapAccount, type OwnedAccount } from "../accounts/repository.server";
import { getVerifiedSession } from "./session.server";

declare const ownerContextBrand: unique symbol;
export type OwnerContext = OwnedAccount & Readonly<{ email: string; [ownerContextBrand]: true }>;

export class OwnerAccessError extends Error {
  constructor(readonly code: "unauthenticated" | "account_unavailable") {
    super(code === "unauthenticated" ? "Sign-in is required" : "Account is temporarily unavailable");
    this.name = "OwnerAccessError";
  }
}

export async function requireOwnerContext(): Promise<OwnerContext> {
  const identity = await getVerifiedSession();
  if (!identity) throw new OwnerAccessError("unauthenticated");
  try {
    const account = await bootstrapAccount(identity);
    if (account.ownerId !== identity.id) throw new OwnerAccessError("account_unavailable");
    // This type marks a trusted server result, not a browser-supplied DTO.
    // Never deserialize an OwnerContext from a request or persist it as auth.
    return Object.freeze({ ...account, email: identity.email }) as OwnerContext;
  } catch {
    throw new OwnerAccessError("account_unavailable");
  }
}
