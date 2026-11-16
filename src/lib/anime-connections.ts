import type { Anime } from "./catalog";
import metadataFile from "./generated-metadata.json";
import connectionsFile from "./generated-connections.json";
import connectionIdentitiesFile from "./generated-connection-identities.json";

export type ConnectionCard = {
  /** Stable key; AniList-backed cards use `anilist:<id>`, genre cards use `genres:<slug>`. */
  id: string;
  title: string;
  titleEn: string;
  year: number | null;
  format: string;
  cover?: string;
  slug?: string;
  href: string;
  available: boolean;
  relation?: string;
  label: string;
  reason?: string;
  source: "anilist" | "genres";
};

export type AnimeConnections = {
  relations: ConnectionCard[];
  similar: ConnectionCard[];
  sourceUrl?: string;
  checkedAt?: string;
};

type MetadataFile = {
  metadata?: Record<string, {
    identity?: { titleEn?: string; titleJa?: string };
    providerId?: number;
    data?: { year?: number };
  }>;
};

type CacheNode = {
  id: number;
  type: "ANIME";
  titleEn: string;
  titleJa?: string;
  titleRomaji?: string;
  year: number | null;
  format: string;
  cover?: string;
};

type CacheEdge = { relationType: string; node: CacheNode };
type CacheEntry = {
  sourceUrl?: string;
  checkedAt?: string;
  identity?: CacheNode & { providerId?: number };
  sources?: Array<{ titleEn?: string; titleJa?: string; year?: number }>;
  relations?: CacheEdge[];
  recommendations?: CacheNode[];
};
type ConnectionsFile = {
  checkedAt?: string;
  entries?: Record<string, CacheEntry>;
};

type IdentityBinding = {
  identity?: {
    titleEn?: string;
    titleJa?: string;
    year?: number;
    format?: string;
    type?: string;
  };
  providerId?: number;
  evidence?: { checkedAt?: string | null; method?: string };
};
type IdentityFile = {
  generatedAt?: string;
  bindings?: Record<string, IdentityBinding>;
};

const metadata = (metadataFile as MetadataFile).metadata ?? {};
const connections = connectionsFile as ConnectionsFile;
const cacheEntries = connections.entries ?? {};
const identityBindings = (connectionIdentitiesFile as IdentityFile).bindings ?? {};

const RELATION_LIMIT = 12;
const DIRECT_RELATION_LIMIT = 10;
const SIMILAR_LIMIT = 8;
const GENRE_LIMIT = 6;
const MAX_GRAPH_DEPTH = 12;
const ANILIST_URL = /^https:\/\/anilist\.co\/anime\/([1-9][0-9]{0,9})\/?$/;

const RELATION_LABELS: Record<string, string> = {
  PREQUEL: "پیش‌درآمد",
  SEQUEL: "دنباله",
  SIDE_STORY: "داستان جانبی",
  SPIN_OFF: "اسپین‌آف",
  ALTERNATIVE: "روایت جایگزین",
  PARENT: "اثر اصلی",
  SUMMARY: "خلاصه",
  COMPILATION: "گردآوری",
  CONTAINS: "شامل",
  OTHER: "مرتبط",
};

const FORMAT_LABELS: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV کوتاه",
  MOVIE: "فیلم",
  SPECIAL: "ویژه",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "موزیک",
};

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseAnilistUrl(value: string | undefined): number | null {
  const match = ANILIST_URL.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

function metadataProviderId(anime: Anime): number | null {
  const entry = metadata[anime.slug];
  if (!entry) return null;
  if (entry.identity?.titleEn !== anime.titleEn) return null;
  if ((entry.identity?.titleJa ?? "") !== (anime.titleJa ?? "")) return null;
  if (anime.year && entry.data?.year && anime.year !== entry.data.year) return null;
  return positiveId(entry.providerId);
}

function identityProviderId(anime: Anime): number | null {
  const binding = identityBindings[anime.slug];
  if (!binding?.identity) return null;
  const identity = binding.identity;
  if ((identity.titleEn ?? "") !== (anime.titleEn ?? "")) return null;
  if ((identity.titleJa ?? "") !== (anime.titleJa ?? "")) return null;
  if ((identity.year ?? 0) !== (anime.year ?? 0)) return null;
  if (identity.format !== undefined && identity.format !== (anime.format ?? "")) return null;
  if (identity.type !== undefined && identity.type !== (anime.type ?? "")) return null;
  return positiveId(binding.providerId);
}

type ProviderResolution = { id: number; via: "metadata" | "url" | "identity" };

function providerFor(anime: Anime): ProviderResolution | null {
  const fromMetadata = metadataProviderId(anime);
  const fromUrl = anime.metadataSource === "anilist" ? parseAnilistUrl(anime.metadataUrl) : null;
  const fromIdentity = identityProviderId(anime);
  if (fromMetadata && fromUrl && fromMetadata !== fromUrl) return null;
  if (fromIdentity && fromMetadata && fromIdentity !== fromMetadata) return null;
  if (fromIdentity && fromUrl && fromIdentity !== fromUrl) return null;
  if (fromMetadata) return { id: fromMetadata, via: "metadata" };
  if (fromUrl) return { id: fromUrl, via: "url" };
  if (fromIdentity) return { id: fromIdentity, via: "identity" };
  return null;
}

function isAnimeNode(node: unknown): node is CacheNode {
  return isRecord(node) && node.type === "ANIME" && positiveId(node.id) !== null
    && typeof node.titleEn === "string";
}

function cacheEntryFor(anime: Anime, provider: ProviderResolution): CacheEntry | null {
  const entry = cacheEntries[String(provider.id)];
  if (!isRecord(entry) || !isRecord(entry.identity)) return null;
  if (entry.identity.providerId !== provider.id || entry.identity.type !== "ANIME") return null;
  if (anime.year && entry.identity.year && anime.year !== entry.identity.year) return null;
  if (!entry.sources?.length && provider.via === "metadata"
    && (entry.identity.titleEn !== anime.titleEn || (entry.identity.titleJa ?? "") !== (anime.titleJa ?? ""))) {
    return null;
  }
  if (Array.isArray(entry.sources) && entry.sources.length > 0) {
    const localYear = anime.year || 0;
    const matchesCurrentIdentity = entry.sources.some(source =>
      source.titleEn === anime.titleEn
      && (source.titleJa ?? "") === (anime.titleJa ?? "")
      && (!(source.year ?? 0) || source.year === localYear));
    if (!matchesCurrentIdentity) return null;
  }
  return entry;
}

function localFormat(anime: Anime): string {
  if (anime.format && anime.format !== "نامشخص") return anime.format;
  if (anime.type === "فیلم") return "MOVIE";
  if (anime.type === "OVA") return "OVA";
  return "";
}

function uniqueLocal(node: CacheNode, index: Map<number, Anime[]>): Anime | undefined {
  const candidates = index.get(node.id);
  if (candidates?.length !== 1) return undefined;
  const local = candidates[0];
  if (local.year && node.year && local.year !== node.year) return undefined;
  const format = localFormat(local);
  return format && node.format && format !== node.format ? undefined : local;
}

function buildLocalIndex(catalogue: Anime[]): Map<number, Anime[]> {
  const index = new Map<number, Anime[]>();
  const seen = new Set<string>();
  for (const anime of catalogue) {
    if (!anime.slug || seen.has(anime.slug)) continue;
    seen.add(anime.slug);
    const provider = providerFor(anime);
    if (!provider) continue;
    const bucket = index.get(provider.id) ?? [];
    bucket.push(anime);
    index.set(provider.id, bucket);
  }
  return index;
}

function anilistHref(id: number): string {
  return `https://anilist.co/anime/${id}`;
}

function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format;
}

function relationLabel(relation: string, format: string): string {
  const base = RELATION_LABELS[relation] ?? relation;
  return format ? `${base} · ${formatLabel(format)}` : base;
}

function relationPriority(relation: string): number {
  return relation === "PREQUEL" ? 0 : relation === "SEQUEL" ? 1 : 2;
}

type CardOptions = {
  relation?: string;
  label: string;
  reason?: string;
  local?: Anime;
};

function cardForNode(node: CacheNode, currentSlug: string, options: CardOptions): ConnectionCard | null {
  if (!isAnimeNode(node) || node.id <= 0) return null;
  const local = options.local && options.local.slug !== currentSlug ? options.local : undefined;
  const format = node.format || (local ? localFormat(local) : "");
  const title = local?.title || node.titleEn || node.titleJa || "";
  const titleEn = local?.titleEn || node.titleEn || node.titleJa || "";
  const year = local?.year || node.year || null;
  return {
    id: `anilist:${node.id}`,
    title,
    titleEn,
    year,
    format,
    cover: local?.cover || node.cover || undefined,
    slug: local?.slug,
    href: local ? `/anime/${local.slug}` : anilistHref(node.id),
    available: Boolean(local),
    relation: options.relation,
    label: options.label,
    reason: options.reason,
    source: "anilist",
  };
}

type PickedRelation = {
  card: ConnectionCard;
  nodeId: number;
  relation: string;
  direct: boolean;
};

function collectRelations(
  entry: CacheEntry,
  currentId: number,
  currentSlug: string,
  localIndex: Map<number, Anime[]>,
): { cards: ConnectionCard[]; knownIds: Set<number> } {
  const picked = new Map<number, PickedRelation>();
  const knownIds = new Set<number>([currentId]);

  const consider = (edge: CacheEdge, direct: boolean, reason?: string) => {
    if (!isAnimeNode(edge.node) || edge.node.id === currentId) return;
    const relation = String(edge.relationType || "");
    if (!RELATION_LABELS[relation]) return;
    knownIds.add(edge.node.id);
    const existing = picked.get(edge.node.id);
    if (existing) {
      if (existing.direct && !direct) return;
      if (existing.direct === direct && relationPriority(existing.relation) <= relationPriority(relation)) return;
    }
    const card = cardForNode(edge.node, currentSlug, {
      relation,
      label: relationLabel(relation, edge.node.format),
      reason,
      local: uniqueLocal(edge.node, localIndex),
    });
    if (!card) return;
    picked.set(edge.node.id, { card, nodeId: edge.node.id, relation, direct });
  };

  const directEdges = (entry.relations ?? [])
    .filter(isRecord)
    .filter(edge => isAnimeNode(edge.node))
    .slice()
    .sort((a, b) => relationPriority(String(a.relationType)) - relationPriority(String(b.relationType)));
  for (const edge of directEdges) consider(edge, true);

  const directCards = [...picked.values()]
    .filter(item => item.direct && item.card.available)
    .sort((a, b) =>
      relationPriority(a.relation) - relationPriority(b.relation)
      || Number(b.card.available) - Number(a.card.available)
      || (a.card.year ?? 9999) - (b.card.year ?? 9999)
      || a.nodeId - b.nodeId)
    .slice(0, DIRECT_RELATION_LIMIT);
  const selected = new Map(directCards.map(item => [item.nodeId, item]));

  const visited = new Set<number>([currentId, ...picked.keys()]);
  const queue = directEdges
    .filter(edge => edge.relationType === "PREQUEL" || edge.relationType === "SEQUEL")
    .map(edge => ({ id: edge.node.id, depth: 1, direction: edge.relationType }));
  while (queue.length > 0 && selected.size < RELATION_LIMIT) {
    const item = queue.shift()!;
    if (item.depth >= MAX_GRAPH_DEPTH) continue;
    const nextEntry = cacheEntries[String(item.id)];
    if (!isRecord(nextEntry) || nextEntry.identity?.providerId !== item.id || nextEntry.identity?.type !== "ANIME" || !Array.isArray(nextEntry.relations)) continue;
    for (const edge of nextEntry.relations) {
      if (!isRecord(edge) || !isAnimeNode(edge.node)) continue;
      if (edge.relationType !== item.direction) continue;
      if (visited.has(edge.node.id) || edge.node.id === currentId) continue;
      visited.add(edge.node.id);
      knownIds.add(edge.node.id);
      const card = cardForNode(edge.node, currentSlug, {
        relation: edge.relationType,
        label: relationLabel(edge.relationType, edge.node.format),
        reason: "از زنجیرهٔ آثار ثبت‌شده",
        local: uniqueLocal(edge.node, localIndex),
      });
      if (!card) continue;
      if (card.available) selected.set(edge.node.id, {
        card,
        nodeId: edge.node.id,
        relation: edge.relationType,
        direct: false,
      });
      if (item.depth + 1 < MAX_GRAPH_DEPTH) queue.push({ id: edge.node.id, depth: item.depth + 1, direction: item.direction });
      if (selected.size >= RELATION_LIMIT) break;
    }
  }

  // A side-story bridge has no honest before/after ordering.  Only one explicit
  // step is followed and the card is labelled as related, never as a prequel or
  // sequel.  Reversed PREQUEL/SEQUEL paths remain excluded.
  const SIDEWORK_RELATIONS = new Set(["SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "PARENT", "SUMMARY", "COMPILATION", "CONTAINS"]);
  for (const visitedId of visited) {
    if (selected.size >= RELATION_LIMIT) break;
    if (visitedId === currentId) continue;
    const sideEntry = cacheEntries[String(visitedId)];
    if (!isRecord(sideEntry) || sideEntry.identity?.providerId !== visitedId || sideEntry.identity?.type !== "ANIME" || !Array.isArray(sideEntry.relations)) continue;
    for (const edge of sideEntry.relations) {
      if (!isRecord(edge) || !isAnimeNode(edge.node)) continue;
      if (!SIDEWORK_RELATIONS.has(String(edge.relationType))) continue;
      if (visited.has(edge.node.id) || edge.node.id === currentId) continue;
      const local = uniqueLocal(edge.node, localIndex);
      if (!local) continue;
      visited.add(edge.node.id);
      knownIds.add(edge.node.id);
      const card = cardForNode(edge.node, currentSlug, {
        relation: "OTHER",
        label: relationLabel("OTHER", edge.node.format),
        reason: "از اثر جانبی مرتبط",
        local,
      });
      if (!card) continue;
      selected.set(edge.node.id, {
        card,
        nodeId: edge.node.id,
        relation: "OTHER",
        direct: false,
      });
      if (selected.size >= RELATION_LIMIT) break;
    }
  }

  const cards = [...selected.values()]
    .sort((a, b) =>
      Number(b.direct) - Number(a.direct)
      || relationPriority(a.relation) - relationPriority(b.relation)
      || Number(b.card.available) - Number(a.card.available)
      || (a.card.year ?? 9999) - (b.card.year ?? 9999)
      || a.nodeId - b.nodeId)
    .slice(0, RELATION_LIMIT)
    .map(item => item.card);
  return { cards, knownIds };
}

function isKnownFranchiseNode(node: Pick<CacheNode, "id">, currentId: number, knownIds: Set<number>): boolean {
  if (node.id === currentId || knownIds.has(node.id)) return true;
  const entry = cacheEntries[String(node.id)];
  if (!isRecord(entry) || entry.identity?.providerId !== node.id || entry.identity?.type !== "ANIME" || !Array.isArray(entry.relations)) return false;
  return entry.relations.some(edge =>
    isRecord(edge) && isAnimeNode(edge.node)
    && (edge.node.id === currentId || knownIds.has(edge.node.id)));
}

function genreCards(
  anime: Anime,
  catalogue: Anime[],
  currentId: number | null,
  knownIds: Set<number>,
): ConnectionCard[] {
  const currentGenres = new Set((anime.genres ?? []).filter(genre => typeof genre === "string" && genre));
  if (currentGenres.size < 2) return [];
  return catalogue
    .filter(candidate => candidate.slug && candidate.slug !== anime.slug)
    .map(candidate => {
      const provider = providerFor(candidate);
      const shared = [...new Set(candidate.genres ?? [])].filter(genre => currentGenres.has(genre));
      return { candidate, provider, shared };
    })
    .filter(item =>
      item.shared.length >= 2
      && !(item.provider && (item.provider.id === currentId || knownIds.has(item.provider.id)
        || isKnownFranchiseNode({ id: item.provider.id }, currentId ?? 0, knownIds))))
    .sort((a, b) =>
      b.shared.length - a.shared.length
      || (a.candidate.year && b.candidate.year
        ? Math.abs(a.candidate.year - anime.year) - Math.abs(b.candidate.year - anime.year) : 0)
      || (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0)
      || a.candidate.slug.localeCompare(b.candidate.slug))
    .slice(0, GENRE_LIMIT)
    .map(({ candidate, shared }) => ({
      id: `genres:${candidate.slug}`,
      title: candidate.title,
      titleEn: candidate.titleEn,
      year: candidate.year || null,
      format: localFormat(candidate),
      cover: candidate.cover || undefined,
      slug: candidate.slug,
      href: `/anime/${candidate.slug}`,
      available: true,
      label: "بر اساس ژانر",
      reason: `حداقل دو ژانر مشترک: ${shared.join("، ")}`,
      source: "genres" as const,
    }));
}

/** Server-only resolver. UI components should import the types, not this function. */
export function getAnimeConnections(anime: Anime, catalogue: Anime[]): AnimeConnections {
  const localIndex = buildLocalIndex(catalogue);
  const provider = providerFor(anime);
  const entry = provider ? cacheEntryFor(anime, provider) : null;

  let relationCards: ConnectionCard[] = [];
  let similarCards: ConnectionCard[] = [];
  let knownIds = new Set<number>();
  const currentId = provider?.id ?? null;
  if (entry && provider) {
    const collected = collectRelations(entry, provider.id, anime.slug, localIndex);
    relationCards = collected.cards;
    knownIds = collected.knownIds;

    const seen = new Set<number>();
    for (const node of entry.recommendations ?? []) {
      if (!isAnimeNode(node) || seen.has(node.id)) continue;
      if (isKnownFranchiseNode(node, provider.id, knownIds)) continue;
      seen.add(node.id);
      const local = uniqueLocal(node, localIndex);
      const card = cardForNode(node, anime.slug, {
        label: "پیشنهاد AniList",
        local,
      });
      if (card?.available) similarCards.push(card);
      if (similarCards.length >= SIMILAR_LIMIT) break;
    }
  }

  if (similarCards.length === 0) {
    similarCards = genreCards(anime, catalogue, currentId, knownIds);
  }

  return {
    relations: relationCards,
    similar: similarCards,
    sourceUrl: entry?.sourceUrl || (provider ? anilistHref(provider.id) : undefined),
    checkedAt: entry?.checkedAt,
  };
}
