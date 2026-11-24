import "server-only";

export type AuthConfig = Readonly<{ appOrigin: string; supabaseUrl: string; publishableKey: string }>;

export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  if (env.APP_MODE !== "pilot") return null;
  try {
    const app = new URL(env.NEXT_PUBLIC_APP_URL ?? "");
    const provider = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    for (const url of [app, provider]) {
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return null;
    }
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) {
      const parts = key.split(".");
      if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role !== "anon") return null;
    }
    return Object.freeze({ appOrigin: app.origin, supabaseUrl: provider.origin, publishableKey: key });
  } catch { return null; }
}
