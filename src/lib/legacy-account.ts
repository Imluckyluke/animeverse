/** Compatibility for pre-server accounts. Never sends old hashes or grants staff access. */
import { emptyPreferences, normalizePreferences, readJson, readLegacyBackup, seedGuestPreferences, writeJson, type Preferences } from "./account-client";
import type { User } from "./app-context";

type LegacyAccount = { name: string; email: string; hash?: string; salt?: string; password?: string };
const SESSION = "av_verified_legacy_session_v1";
function accounts(): LegacyAccount[] {
  const raw = readJson<unknown>("av_accounts");
  return Array.isArray(raw) ? raw.filter((value): value is LegacyAccount => Boolean(value && typeof value.name === "string" && typeof value.email === "string")) : [];
}
function publicUser(account: LegacyAccount): User {
  return { name: account.name, email: account.email, joinedAt: "", role: "user", localOnly: true };
}
export async function verifyLegacyAccount(email: string, password: string): Promise<User | null> {
  const account = accounts().find(item => item.email.trim().toLowerCase() === email.trim().toLowerCase());
  if (!account || password.length < 6 || password.length > 256) return null;
  let valid = false;
  if (typeof account.hash === "string" && typeof account.salt === "string" && account.salt.length <= 128) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account.salt + ":" + password));
    const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    valid = hex === account.hash;
  } else if (typeof account.password === "string") valid = account.password === password;
  if (!valid) return null;
  writeJson(SESSION, { email: account.email, expires: Date.now() + 30 * 86400_000 });
  return publicUser(account);
}
export function readLegacySession(): User | null {
  const marker = readJson<{ email?: string; expires?: number }>(SESSION);
  if (!marker || typeof marker.email !== "string" || typeof marker.expires !== "number" || marker.expires <= Date.now()) return null;
  const account = accounts().find(item => item.email === marker.email);
  return account ? publicUser(account) : null;
}
export function clearLegacySession() { try { localStorage.removeItem(SESSION); } catch { /* no server cookie exists for this identity */ } }
function key(email: string) { return "av_legacy_preferences_v1:" + email.trim().toLowerCase(); }
export function legacyPreferences(email: string): Preferences {
  const saved = readJson<unknown>(key(email));
  if (saved) return normalizePreferences(saved);
  const backup = readLegacyBackup();
  if (backup?.user?.email.trim().toLowerCase() === email.trim().toLowerCase()) return normalizePreferences(backup.preferences);
  const previous = readJson<{ email?: string }>("av_user");
  return previous?.email?.trim().toLowerCase() === email.trim().toLowerCase() ? seedGuestPreferences() : emptyPreferences();
}
export function saveLegacyPreferences(email: string, value: Preferences) { writeJson(key(email), value); }
