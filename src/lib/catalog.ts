/**
 * Client-safe catalogue helpers.
 *
 * This module must never import `real-catalog.json` (or anything that does).
 * Every client component that needs types, pure helpers or static option
 * lists imports from here, so the ~3.4 MB catalogue stays on the server and
 * never lands in a browser bundle.
 */

export type AnimeStatus = "در حال پخش" | "پایان یافته" | "به‌زودی";
export type AnimeType = "سریال" | "فیلم" | "OVA";

export type Art = {
  from: string;
  to: string;
  accent: string;
  glyph: string;
};

export type EpisodeQuality = {
  label: string;
  deepLink: string;
  status: "pending" | "done" | "failed";
  url?: string;
  size?: number;
};

export type EpisodeData = {
  number: number;
  title: string;
  runtime: string;
  releasedAt: string;
  qualities: EpisodeQuality[];
};

export type Anime = {
  slug: string;
  title: string;
  titleEn: string;
  titleJa: string;
  year: number;
  season: string;
  score: number;
  votes: number;
  episodes: number;
  /** Episodes currently present in the archive (may be fewer than the series total). */
  availableEpisodes?: number;
  duration: string;
  type: AnimeType;
  format?: string;
  status: AnimeStatus;
  studio: string;
  producers?: string;
  genres: string[];
  synopsis: string;
  tagline: string;
  art: Art;
  quality: string[];
  audio: string[];
  ageRating: string;
  featured?: boolean;
  rank?: number;
  weeklyViews: number;
  popularity: number;
  updatedAt: string;
  /** Only set when the upstream source provides a confirmed next-release time. */
  nextEpisodeAt?: string;
  cover?: string;
  banner?: string;
  source?: "demo" | "aniplus";
  aniplusId?: string;
  watchUrl?: string;
  episodeData?: EpisodeData[];
};

/** The minimum contract for the client-side admin overrides (hide/pin/patch). */
export type AdminPatchable = Pick<Anime, "slug" | "titleEn" | "score" | "episodes">;

/**
 * The subset of catalogue fields the home hero needs. Sending only these keeps
 * the home-page RSC payload small while still letting the client-side admin
 * star promote any title into the hero.
 */
export type HeroAnime = Pick<
  Anime,
  | "slug"
  | "title"
  | "titleEn"
  | "cover"
  | "banner"
  | "art"
  | "score"
  | "year"
  | "type"
  | "status"
  | "episodes"
  | "availableEpisodes"
  | "synopsis"
>;

export type Episode = {
  number: number;
  title: string;
  runtime: string;
  releasedAt: string;
  filler?: boolean;
  qualities?: EpisodeQuality[];
};

export type SearchItem = {
  slug: string;
  title: string;
  titleEn: string;
  year: number;
  score: number;
  type: AnimeType;
  art: Art;
  genres: string[];
};

export const GENRES = [
  { name: "اکشن", en: "Action", from: "#ff6b6b", to: "#ff9f43", icon: "swords" },
  { name: "فانتزی", en: "Fantasy", from: "#7c6bff", to: "#38d6ff", icon: "sparkles" },
  { name: "ماجراجویی", en: "Adventure", from: "#38d6ff", to: "#3ddc97", icon: "compass" },
  { name: "درام", en: "Drama", from: "#ff6ba6", to: "#a855f7", icon: "theater" },
  { name: "کمدی", en: "Comedy", from: "#ffd05c", to: "#ff8a5c", icon: "laugh" },
  { name: "عاشقانه", en: "Romance", from: "#ff8fbc", to: "#a78bfa", icon: "heart" },
  { name: "علمی-تخیلی", en: "Sci-Fi", from: "#38d6ff", to: "#6366f1", icon: "rocket" },
  { name: "معمایی", en: "Mystery", from: "#8b5cf6", to: "#1e1b4b", icon: "search" },
  { name: "روان‌شناختی", en: "Psychological", from: "#6d28d9", to: "#db2777", icon: "brain" },
  { name: "ورزشی", en: "Sports", from: "#22c55e", to: "#0ea5e9", icon: "trophy" },
  { name: "موسیقی", en: "Music", from: "#ec4899", to: "#f59e0b", icon: "music" },
  { name: "ایسکای", en: "Isekai", from: "#6366f1", to: "#10b981", icon: "door" },
] as const;

export const YEAR_OPTIONS = [
  2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2016, 2014, 2011, 2009, 2006, 1999,
] as const;

export function splitQualities(qualities: string[]) {
  const unique = Array.from(new Set(qualities));
  return {
    base: unique.filter((quality) => !/x265/i.test(quality)),
    x265: unique.some((quality) => /x265/i.test(quality)),
    all: unique,
  };
}

const CHINESE_STUDIOS = new Set([
  "BigFireBird Animation",
  "CMC Media",
  "CG Year",
  "Dancing CG Studio",
  "HuaMei Animation",
  "Bilibili",
  "Tencent Penguin Pictures",
  "Paper Plane Animation Studio",
  "Studio LAN",
  "Colored Pencil Animation Japan",
  "B.CMAY PICTURES",
  "Wonder Cat Animation",
  "Liyu Culture",
  "2:10 AM Animation",
  "Shanghai Foch Film and TV Culture Investment",
  "Flint Sugar",
  "Garden Culture",
  "Liu Lin Yi Dongman",
  "Pb Animation Co. Ltd.",
]);

// Archive-only Chinese donghua whose AniPlus post lacks a usable studio or
// producer string. These were verified from the archive title/Chinese
// original title, and are kept explicit so Japanese ONA titles are not swept
// into the Chinese collection by the ONA format alone.
const CHINESE_SLUGS = new Set([
  "a-good-day-to-ascend",
  "link-click-season-3",
  "spare-me-great-lord-season-3",
  "the-eternal-supreme-li-yunxiao",
  "false-memory",
  "shen-yin-wangzuo-2nd-season",
  "binghuo-mochu",
  "super-xiang",
  "the-golden-wug",
  "a-war-between-humans-and-ai",
  "mythical-creatures-are-my-dinners",
  "the-super-cube",
  "tian-ying",
  "the-young-brewmasters-adventure-2nd-season",
]);

// AniPlus marks Chinese donghua as ONA. Japanese ONA also exist (JoJo Steel
// Ball Run, Cyberpunk), so ONA alone is not enough: require a Chinese studio
// or a Chinese producer/platform as well.
const CHINESE_PRODUCERS =
  /bilibili|iqiyi|tencent|youku|china literature|beijing|huamei|bigfirebird|cmc media|cg year|kuaikan|yuewen|bedream/i;

export function isChineseAnime(anime: Anime): boolean {
  if (CHINESE_SLUGS.has(anime.slug) || CHINESE_STUDIOS.has(anime.studio)) {
    return true;
  }
  if (anime.format !== "ONA") return false;
  return CHINESE_PRODUCERS.test(anime.producers || "");
}

// A few archive-only films arrive from AniPlus with an empty/incorrect type
// field. Keep them in the cinema rail without guessing from episode count
// (which would also turn TV specials into films).
export const EXTRA_MOVIE_SLUGS = new Set([
  "tokyo-godfathers",
  "virgin-punk-clockwork-girl",
  "all-you-need-is-kill",
  "build-divide-code-white",
  "scarlet",
]);

export function hashString(value: string) {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function seededShuffle<T extends { slug: string }>(items: T[], seed: string): T[] {
  return items
    .map((item) => ({ item, key: hashString(`${seed}:${item.slug}`) }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

const EPISODE_TITLES = [
  "آغاز یک سفر",
  "سایه‌های گذشته",
  "شکاف",
  "قرارداد",
  "طلوع",
  "خون و خاکستر",
  "پیمان",
  "غروب سرخ",
  "بازگشت",
  "نبرد آخر",
  "خاطرهٔ گمشده",
  "سرنوشت",
];

export function getEpisodes(anime: Anime): Episode[] {
  if (anime.episodeData?.length) {
    return [...anime.episodeData]
      .sort((a, b) => b.number - a.number)
      .map((episode) => ({
        number: episode.number,
        title: episode.title,
        runtime: episode.runtime,
        releasedAt: episode.releasedAt,
        qualities: episode.qualities,
      }));
  }
  if (anime.type === "فیلم") {
    return [
      {
        number: 1,
        title: anime.titleEn,
        runtime: anime.duration,
        releasedAt: anime.updatedAt,
      },
    ];
  }
  const shown = Math.min(anime.episodes, 12);
  const start = anime.episodes - shown + 1;
  // Deterministic per-slug seed, so this stays a pure function with no need to
  // know the full catalogue.
  const base = hashString(anime.slug) % 997;
  return Array.from({ length: shown }, (_, i) => {
    const number = start + i;
    return {
      number,
      title: EPISODE_TITLES[(base + number) % EPISODE_TITLES.length],
      runtime: anime.duration,
      releasedAt: new Date(Date.parse(anime.updatedAt) - (shown - i - 1) * 7 * 86400000).toISOString(),
      filler: (base + number) % 13 === 0,
    };
  }).reverse();
}

export function getGenreSlug(name: string): string {
  return GENRES.find((g) => g.name === name)?.en.toLowerCase() ?? name;
}

export function searchAnime(
  list: Anime[],
  opts: {
    q?: string;
    genres?: string[];
    year?: number | null;
    type?: string | null;
    status?: string | null;
    audio?: string | null;
    sort?: "latest" | "score" | "views" | "alpha";
  },
): Anime[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  let out = list.filter((a) => {
    if (q) {
      const hay = `${a.title} ${a.titleEn} ${a.titleJa} ${a.studio} ${a.genres.join(" ")} ${a.synopsis}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (opts.genres?.length && !opts.genres.every((g) => a.genres.includes(g))) return false;
    if (opts.year && a.year !== opts.year) return false;
    if (opts.type && a.type !== opts.type) return false;
    if (opts.status && a.status !== opts.status) return false;
    if (opts.audio && !a.audio.includes(opts.audio)) return false;
    return true;
  });
  switch (opts.sort) {
    case "score":
      out = out.sort((a, b) => b.score - a.score);
      break;
    case "views":
      out = out.sort((a, b) => b.weeklyViews - a.weeklyViews);
      break;
    case "alpha":
      out = out.sort((a, b) => a.titleEn.localeCompare(b.titleEn, "en"));
      break;
    default:
      out = out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return out;
}
