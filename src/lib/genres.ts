import taxonomy from "./genre-taxonomy.json";

function clean(value: string): string {
  return value.normalize("NFKC").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u064b-\u065f\u0670\u0640\u200b\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/[_\u200c\u200d-]+/g, " ").replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
}

const names = new Map<string, string>(taxonomy.names.map(name => [clean(name), name]));
for (const [alias, name] of Object.entries(taxonomy.aliases)) names.set(clean(alias), name);
const ignored = new Set(taxonomy.ignored.map(clean));
const phrases = [...names.keys()].sort((a, b) => b.length - a.length);

/** Split source delimiters, not spaces inside real multiword genre names. */
export function normalizeGenres(input: readonly string[] | string | null | undefined): string[] {
  const output = new Set<string>();
  for (const raw of typeof input === "string" ? [input] : input ?? []) {
    if (typeof raw !== "string") continue;
    for (const part of raw.split(/[#＃,،;؛|/\n\r]+/)) {
      const value = clean(part);
      if (!value || ignored.has(value.toLowerCase())) continue;
      const exact = names.get(value);
      if (exact) { output.add(exact); continue; }
      // Recover missing delimiters only when the ENTIRE phrase is known.
      let rest = value;
      const found: string[] = [];
      while (rest) {
        const phrase = phrases.find(name => rest === name || rest.startsWith(name + " "));
        if (!phrase) break;
        found.push(names.get(phrase)!);
        rest = rest.slice(phrase.length).trim();
      }
      if (!rest && found.length) found.forEach(name => output.add(name));
      // Retain unfamiliar valid labels; reject leaked headings/URLs/emoji.
      else if (value.length <= 60 && /^[\p{L}\p{N} ]+$/u.test(value)) output.add(value);
    }
  }
  return [...output];
}
