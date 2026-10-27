/** Offline catalogue presentation cleanup; never infer dates from post times. */
const seasons: Record<string, string> = { spring: "بهار", summer: "تابستان", fall: "پاییز", autumn: "پاییز", winter: "زمستان" };

export function cleanSynopsis(raw: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const value = (raw ?? "").replace(/&([a-z]+);/gi, (whole, name: string) => entities[name.toLowerCase()] ?? whole)
    .replace(/<(?:br|p|div)\b[^>]*>|<\/(?:p|div)>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^)\s]+\)/g, "$1")
    .replace(/\(\s*(?:منبع|source)\s*:[^)\n]{0,250}\)|\[\s*Written by[^\]\n]{0,250}\]/gi, "");
  const output: string[] = [];
  for (let line of value.split(/\r?\n/)) {
    line = line.replace(/^\s*[*`]+|[*`]+\s*$/g, "").trim();
    if (/^(?:📜\s*)?خلاصه(?: داستان)?\s*[:：]?$/u.test(line)) continue;
    if (/^(?:[📖📥👥🔗🏷⭐🎭]|(?:ژانرها?|فصل|نوع|تعداد قسمت|نام انگلیسی|نام فارسی|استودیو|وضعیت|زمان هر قسمت|رده سنی|منبع ساخت)\s*[:：]|(?:اطلاعات تکمیلی|اطلاعات تیم ترجمه|لینک.?های دانلود))/u.test(line)) break;
    if (/^(?:https?:\/\/\S+|@[\w_]+)$/.test(line)) continue;
    output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function cleanSeason(raw: string): string {
  raw = (raw ?? "").replace(/[يى]/g, "ی").replace(/ك/g, "ک");
  for (const name of ["بهار", "تابستان", "پاییز", "زمستان"]) if (raw?.includes(name)) return name;
  for (const [name, translated] of Object.entries(seasons)) if (new RegExp(`\\b${name}\\b`, "i").test(raw)) return translated;
  return "نامشخص";
}

export function cleanCatalogueRecord<T extends { year: number; season: string; synopsis: string }>(anime: T): T {
  return { ...anime, year: Number.isInteger(anime.year) && anime.year >= 1900 && anime.year <= 2100 ? anime.year : 0, season: cleanSeason(anime.season), synopsis: cleanSynopsis(anime.synopsis) };
}
