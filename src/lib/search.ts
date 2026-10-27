/** Pure, client-safe title search: no catalogue, server imports or dependencies. */
export type SearchableTitle = {
  title?: string;
  titleEn?: string;
  titleJa?: string;
  slug?: string;
};

type Alias = { text: string; compact: string; words: string[] };
type CachedAliases = { values: (string | undefined)[]; aliases: Alias[] };
const aliasCache = new WeakMap<SearchableTitle, CachedAliases>();
const MAX_FUZZY_RESULTS = 12;
const MAX_FUZZY_LENGTH = 64;

/** Fold Arabic/Persian letters, accents, punctuation and word separators. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").toLowerCase()
    .replace(/[\u064a\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .replace(/[\p{M}\u0640]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function aliasesFor(item: SearchableTitle): Alias[] {
  const cached = aliasCache.get(item);
  // Admin edits can replace a field on an existing object; never reuse stale text.
  if (cached && cached.values[0] === item.title && cached.values[1] === item.titleEn
    && cached.values[2] === item.titleJa && cached.values[3] === item.slug) return cached.aliases;
  const values = [item.title, item.titleEn, item.titleJa, item.slug];
  const aliases = [...new Set(values.filter((value): value is string => !!value).map(normalizeSearchText))]
    .filter(Boolean)
    .map((text) => ({ text, compact: text.replace(/ /g, ""), words: text.split(" ") }));
  aliasCache.set(item, { values, aliases });
  return aliases;
}

/** Banded edit distance, including adjacent transpositions; at most two edits. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit || b.length > MAX_FUZZY_LENGTH) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(limit + 1);
    current[0] = i;
    let minimum = limit + 1;
    for (let j = Math.max(1, i - limit); j <= Math.min(b.length, i + limit); j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      }
      minimum = Math.min(minimum, current[j]);
    }
    if (minimum > limit) return limit + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

function typoBudget(word: string): number {
  // No fuzzy matching for short fragments or season/episode numbers.
  return word.length < 4 || /\p{N}/u.test(word) ? 0 : word.length >= 10 ? 2 : 1;
}

function directScore(alias: Alias, query: Alias): number {
  if (alias.text === query.text) return 0;
  if (alias.compact === query.compact) return 1;
  if (alias.text.startsWith(query.text)) return 2;
  const position = alias.text.indexOf(query.text);
  if (position >= 0) return position === 0 || alias.text[position - 1] === " " ? 3 : 4;
  if (alias.compact.startsWith(query.compact)) return 5;
  if (alias.compact.includes(query.compact)) return 6;
  return Infinity;
}

function wordScore(alias: Alias, query: Alias): number {
  // All query words must match distinct words in ONE alias, never a synopsis or
  // a mixture of unrelated language fields. Bound work for pasted long queries.
  if (query.words.length > 8 || query.compact.length > MAX_FUZZY_LENGTH) return Infinity;
  const available = alias.words.slice(0, 32);
  const remaining: string[] = [];
  for (const word of query.words) {
    let index = available.indexOf(word);
    if (index < 0 && word.length >= 2) index = available.findIndex((candidate) => candidate.startsWith(word));
    if (index < 0) remaining.push(word);
    else available.splice(index, 1);
  }
  if (!remaining.length) return 8;
  let edits = 0;
  const totalBudget = query.compact.length >= 10 ? 2 : 1;
  for (const word of remaining) {
    const budget = Math.min(typoBudget(word), totalBudget - edits);
    if (!budget) return Infinity;
    let best = budget + 1;
    let index = -1;
    for (let i = 0; i < available.length; i += 1) {
      if (/\p{N}/u.test(available[i])) continue;
      const distance = editDistance(word, available[i], budget);
      if (distance < best) { best = distance; index = i; }
    }
    if (index < 0) return Infinity;
    edits += best;
    available.splice(index, 1);
  }
  return 20 + edits;
}

/** Ranked title/English/Japanese/slug aliases; stable ties preserve caller sorting.
 * Literal matches always precede a maximum of twelve conservative typo matches.
 */
export function searchTitles<T extends SearchableTitle>(items: readonly T[], rawQuery: string): T[] {
  if (!rawQuery.trim()) return [...items];
  if (rawQuery.length > 512) return [];
  const text = normalizeSearchText(rawQuery);
  if (!text || text.length > 160) return [];
  const query: Alias = { text, compact: text.replace(/ /g, ""), words: text.split(" ") };
  const ranked: { item: T; score: number; index: number }[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const aliases = aliasesFor(item);
    let score = Infinity;
    for (const alias of aliases) score = Math.min(score, directScore(alias, query));
    if (!Number.isFinite(score)) {
      for (const alias of aliases) {
        score = Math.min(score, wordScore(alias, query));
        // Also tolerate a typo when a whole title was typed without its spaces.
        const budget = query.words.length === 1 && query.compact.length <= MAX_FUZZY_LENGTH ? typoBudget(query.compact) : 0;
        if (budget && !/\p{N}/u.test(alias.compact)) {
          const distance = editDistance(query.compact, alias.compact, budget);
          if (distance <= budget) score = Math.min(score, 20 + distance);
        }
      }
    }
    if (Number.isFinite(score)) ranked.push({ item, score, index });
  }
  ranked.sort((a, b) => a.score - b.score || a.index - b.index);
  let fuzzyCount = 0;
  return ranked.filter(({ score }) => score < 20 || ++fuzzyCount <= MAX_FUZZY_RESULTS).map(({ item }) => item);
}
