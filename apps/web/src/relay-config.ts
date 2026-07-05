// Client for the cloud relay (M18C T1's Worker): OAuth sign-in + browser-resident BYO keys.
// Every route lives under /api on the same origin as the deployed site, so plain same-origin
// fetches carry the fs_session cookie with no CORS involved — see apps/relay/src/index.ts.

export interface RelayUser {
  id: string;
  name: string;
  provider: string;
}

export interface UserKeys {
  falKey?: string;
  openRouterKey?: string;
}

export type AuthProvider = "google" | "github";

const KEYS_STORAGE_KEY = "fs.keys";

// "" (same origin) by default; VITE_RELAY_ORIGIN overrides it for local dev against `wrangler dev`,
// which runs the Worker on its own port separate from the Vite dev server.
export function getRelayOrigin(): string {
  return (import.meta.env.VITE_RELAY_ORIGIN as string | undefined) ?? "";
}

export function getUserKeys(): UserKeys {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UserKeys;
    return {
      ...(typeof parsed.falKey === "string" ? { falKey: parsed.falKey } : {}),
      ...(typeof parsed.openRouterKey === "string" ? { openRouterKey: parsed.openRouterKey } : {}),
    };
  } catch {
    return {};
  }
}

// Merges onto whatever's already stored so a caller can save just the field it changed.
export function setUserKeys(keys: UserKeys): void {
  const merged = { ...getUserKeys(), ...keys };
  localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(merged));
}

export async function fetchMe(): Promise<RelayUser | null> {
  try {
    const res = await fetch(`${getRelayOrigin()}/api/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    const json = (await res.json()) as { user?: RelayUser };
    return json.user ?? null;
  } catch {
    return null;
  }
}

export function loginUrl(provider: AuthProvider): string {
  return `${getRelayOrigin()}/api/auth/${provider}`;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${getRelayOrigin()}/api/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // best-effort — the caller clears local UI state regardless of network failure
  }
}
