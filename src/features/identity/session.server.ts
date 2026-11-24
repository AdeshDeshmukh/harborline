import "server-only";
import { cookies } from "next/headers";
import { loadAuthConfig } from "./config.server";
import { cookieOptions, createAuthClient } from "./supabase.server";
import type { AuthPort, VerifiedIdentity } from "./types";

export async function verifySession(client: AuthPort): Promise<VerifiedIdentity | null> {
  try {
    const { data, error } = await client.auth.getUser();
    const user = data?.user;
    if (error || !user || typeof user !== "object" || !("id" in user) || !("email" in user) ||
      !("email_confirmed_at" in user) || !("is_anonymous" in user) || user.is_anonymous !== false ||
      typeof user.id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user.id) ||
      typeof user.email !== "string" || user.email.length > 254 ||
      typeof user.email_confirmed_at !== "string" || !Number.isFinite(Date.parse(user.email_confirmed_at))) return null;
    return Object.freeze({ id: user.id, email: user.email });
  } catch { return null; }
}

export async function getVerifiedSession(): Promise<VerifiedIdentity | null> {
  const config = loadAuthConfig();
  if (!config) return null;
  const store = await cookies();
  const client = createAuthClient(config, {
    getAll: () => store.getAll(),
    setAll: values => {
      try { for (const { name, value, options } of values) store.set(name, value, { ...options, ...cookieOptions(config) }); }
      catch { /* RSC cannot write cookies; Proxy persists refresh before rendering. */ }
    },
  });
  return verifySession(client);
}
