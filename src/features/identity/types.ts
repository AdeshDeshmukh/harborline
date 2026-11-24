export type AuthPort = { auth: {
  getUser(): Promise<{ data: { user: unknown } | null; error: unknown }>;
  signInWithOtp(input: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }): Promise<{ error: unknown }>;
  exchangeCodeForSession(code: string): Promise<{ error: unknown }>;
  signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
} };
export type VerifiedIdentity = Readonly<{ id: string; email: string }>;
