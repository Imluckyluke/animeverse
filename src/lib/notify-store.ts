import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.AV_DATA_DIR || path.join(process.cwd(), "data");
const PROFILES_PATH = path.join(DATA_DIR, "notify-profiles.json");
const SUBSCRIPTIONS_PATH = path.join(DATA_DIR, "notify-subscriptions.json");
const LINKS_PATH = path.join(DATA_DIR, "notify-links.json");
const BOT_PATH = path.join(DATA_DIR, "notify-bot.json");

const LINK_TTL_MS = 20 * 60 * 1000;
const FALLBACK_BOT = "Anotifersbot";

type Profile = {
  favorites: string[];
  enabled: boolean;
  updatedAt: string;
};

type Subscription = {
  chatId: number | string;
  username?: string;
  firstName?: string;
  linkedAt: string;
  enabled?: boolean;
};

type LinkEntry = {
  clientId: string;
  createdAt: string;
  expiresAt: string;
};

type LinkFile = Record<string, LinkEntry>;
type ProfileFile = Record<string, Profile>;
type SubscriptionFile = Record<string, Subscription>;

type BotMeta = { username?: string };

export type NotificationStatus = {
  linked: boolean;
  enabled: boolean;
  favoritesCount: number;
  botUsername: string;
  pendingCode: boolean;
};

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Serialise read/modify/write operations in this Node process. The Python
 * bot writes a different pair of files, so the site and bot never mutate the
 * same JSON document.
 */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = writeChain.then(work, work);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function filePath(name: "profiles" | "subscriptions" | "links" | "bot") {
  if (name === "profiles") return PROFILES_PATH;
  if (name === "subscriptions") return SUBSCRIPTIONS_PATH;
  if (name === "links") return LINKS_PATH;
  return BOT_PATH;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, payload: unknown) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    // Serverless hosts such as Vercel ship a read-only filesystem: the bot's
    // shared JSON store simply cannot live there. Report it as "unavailable"
    // instead of letting a 500 escape to the client.
    throw new StoreUnavailableError(error);
  }
}

/**
 * Thrown when the notification store cannot be written (e.g. a read-only
 * serverless filesystem). Routes translate this into a friendly 503.
 */
export class StoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("notification store is not writable");
    this.name = "StoreUnavailableError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Turns any store failure into a friendly, non-500 API response. */
export function isStoreUnavailable(error: unknown): boolean {
  return error instanceof StoreUnavailableError;
}

export function validClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

export function normalizeFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim().slice(0, 120);
    if (!slug) continue;
    seen.add(slug);
    if (seen.size >= 250) break;
  }
  return [...seen];
}

async function botUsername(): Promise<string> {
  const meta = await readJson<BotMeta>(filePath("bot"), {});
  const username = typeof meta.username === "string" ? meta.username.trim() : "";
  return username || FALLBACK_BOT;
}

export async function getNotificationStatus(clientId: string): Promise<NotificationStatus> {
  const [subscriptions, profiles, username] = await Promise.all([
    readJson<SubscriptionFile>(filePath("subscriptions"), {}),
    readJson<ProfileFile>(filePath("profiles"), {}),
    botUsername(),
  ]);
  const subscription = subscriptions[clientId];
  const profile = profiles[clientId];
  return {
    linked: Boolean(subscription?.chatId),
    enabled: profile?.enabled ?? subscription?.enabled ?? true,
    favoritesCount: profile?.favorites?.length ?? 0,
    botUsername: username,
    pendingCode: false,
  };
}

export async function createNotificationLink(clientId: string, favorites: string[]) {
  return serial(async () => {
    const now = Date.now();
    const [profiles, links, username] = await Promise.all([
      readJson<ProfileFile>(filePath("profiles"), {}),
      readJson<LinkFile>(filePath("links"), {}),
      botUsername(),
    ]);

    for (const [code, entry] of Object.entries(links)) {
      const expires = Date.parse(entry.expiresAt || entry.createdAt || "");
      if (!Number.isFinite(expires) || now - expires > 0) delete links[code];
    }

    const profile = profiles[clientId];
    profiles[clientId] = {
      favorites,
      enabled: true,
      updatedAt: new Date(now).toISOString(),
    };

    const code = randomBytes(18).toString("base64url");
    links[code] = {
      clientId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LINK_TTL_MS).toISOString(),
    };

    await Promise.all([
      writeJson(filePath("profiles"), profiles),
      writeJson(filePath("links"), links),
    ]);

    return {
      url: `https://t.me/${username}?start=${encodeURIComponent(code)}`,
      botUsername: username,
      expiresIn: Math.round(LINK_TTL_MS / 1000),
      hadProfile: Boolean(profile),
    };
  });
}

export async function updateNotificationPreferences(
  clientId: string,
  updates: { favorites?: string[]; enabled?: boolean },
): Promise<NotificationStatus> {
  await serial(async () => {
    const profiles = await readJson<ProfileFile>(filePath("profiles"), {});
    const current = profiles[clientId];
    profiles[clientId] = {
      favorites: updates.favorites ?? current?.favorites ?? [],
      enabled: updates.enabled ?? current?.enabled ?? true,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(filePath("profiles"), profiles);
  });
  return getNotificationStatus(clientId);
}

export async function unlinkNotification(clientId: string): Promise<NotificationStatus> {
  await serial(async () => {
    const [subscriptions, profiles] = await Promise.all([
      readJson<SubscriptionFile>(filePath("subscriptions"), {}),
      readJson<ProfileFile>(filePath("profiles"), {}),
    ]);
    delete subscriptions[clientId];
    if (profiles[clientId]) {
      profiles[clientId] = { ...profiles[clientId], enabled: false, updatedAt: new Date().toISOString() };
    }
    await Promise.all([
      writeJson(filePath("subscriptions"), subscriptions),
      writeJson(filePath("profiles"), profiles),
    ]);
  });
  return getNotificationStatus(clientId);
}
