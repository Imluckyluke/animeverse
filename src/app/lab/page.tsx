import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FlaskConical, Sparkles } from "lucide-react";
import { ANIME } from "@/lib/data";
import { GENRES, getEpisodes, type HeroAnime } from "@/lib/catalog";
import type { LabAnime } from "@/components/lab/types";
import { cn, faDigits } from "@/lib/utils";
import { ScrollProgress } from "@/components/lab/scroll-progress";
import { HeroSpotlight } from "@/components/lab/hero-spotlight";
import { ShelfVitrine } from "@/components/lab/shelf-vitrine";
import { ShelfCoverflow } from "@/components/lab/shelf-coverflow";
import { RowElastic } from "@/components/lab/row-elastic";
import { TiltCard, FlipCard } from "@/components/lab/cards-interactive";
import { DeckStack } from "@/components/lab/deck-stack";
import { EpisodeTimeline } from "@/components/lab/episode-timeline";
import { QualitySwitch } from "@/components/lab/quality-switch";
import { CommandPalette } from "@/components/lab/command-palette";
import { GenreBubbles } from "@/components/lab/genre-bubbles";
import { GridReveal } from "@/components/lab/grid-reveal";

export const metadata: Metadata = {
  title: "آزمایشگاه طراحی",
  description: "دوازده نمونهٔ تعاملی برای بخش‌های مختلف انیمه‌ورس.",
  robots: { index: false, follow: false },
};

const slim = (anime: (typeof ANIME)[number]): HeroAnime => ({
  slug: anime.slug,
  title: anime.title,
  titleEn: anime.titleEn,
  cover: anime.cover,
  banner: anime.banner,
  art: anime.art,
  score: anime.score,
  year: anime.year,
  type: anime.type,
  status: anime.status,
  episodes: anime.episodes,
  availableEpisodes: anime.availableEpisodes,
  synopsis: anime.synopsis,
});

const slimLab = (anime: (typeof ANIME)[number]): LabAnime => ({
  ...slim(anime),
  genres: anime.genres ?? [],
});

const withArt = ANIME.filter((anime) => Boolean(anime.cover));
const byScore = [...withArt].sort((a, b) => b.score - a.score);
const byDate = [...withArt].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

const spotlight = slim(byScore.find((anime) => anime.banner) ?? byScore[0]);
const topRated = byScore.slice(0, 14).map(slim);
const latest = byDate.slice(0, 14).map(slim);
const movies = withArt.filter((anime) => anime.type === "فیلم").slice(0, 12).map(slim);
const airing = withArt.filter((anime) => anime.status === "در حال پخش").slice(0, 14).map(slim);
const flips = byScore.slice(0, 4).map(slimLab);
const palette = byScore.slice(0, 40).map(slim);

const bubbleGenres = GENRES.map((genre) => ({
  name: genre.name,
  slug: genre.name,
  count: ANIME.filter((anime) => (anime.genres ?? []).includes(genre.name)).length,
}))
  .sort((a, b) => b.count - a.count)
  .slice(0, 14);

const episodeSource =
  byScore.find((anime) => (anime.episodeData?.length ?? 0) > 5) ??
  byScore.find((anime) => anime.type !== "فیلم") ??
  byScore[0];

const episodes = getEpisodes(episodeSource)
  .slice(-6)
  .reverse()
  .map((episode) => ({
    number: episode.number,
    title: episode.title || `قسمت ${episode.number}`,
    size: "۱.۲ گیگابایت",
    qualities: [
      { label: "۱۰۸۰p", size: "۱.۲ گیگابایت" },
      { label: "۷۲۰p", size: "۶۴۰ مگابایت" },
      { label: "۴۸۰p", size: "۳۱۰ مگابایت" },
    ],
  }));

function Demo({
  n,
  title,
  note,
  source,
  children,
  wide = false,
}: {
  n: number;
  title: string;
  note: string;
  source: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section id={`d${n}`} className={cn("min-w-0 max-w-full scroll-mt-20", wide && "lg:col-span-2")}>
      <header className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-[12px] font-black text-amber-300">
          {faDigits(n)}
        </span>
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-2 text-[16px] font-black text-white">
            {title}
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-bold text-white/45">
              الهام از {source}
            </span>
          </h2>
          <p className="mt-1.5 max-w-[68ch] text-[11.5px] leading-6 text-content-muted">{note}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export default function LabPage() {
  return (
    <div className="shell py-8">
      <ScrollProgress />

      <header className="mb-10 rounded-[28px] border border-white/[0.1] bg-[radial-gradient(circle_at_88%_-10%,rgba(255,183,0,.16),transparent_55%)] p-5 backdrop-blur-md sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip border-amber-400/30 bg-amber-400/10 text-amber-300">
            <FlaskConical className="size-3.5" />
            پیش‌نمایش
          </span>
          <span className="chip">
            <Sparkles className="size-3.5 text-amber-300" />
            ۱۲ نمونه
          </span>
          <span className="chip text-white/45">سایت اصلی دست‌نخورده</span>
        </div>

        <h1 className="mt-4 text-xl font-black leading-9 text-white sm:text-[26px]">
          آزمایشگاه طراحی انیمه‌ورس
        </h1>
        <p className="mt-2 max-w-2xl text-[12.5px] leading-7 text-content-muted">
          دوازده ایده برای جاهای مختلف سایت — از قهرمان صفحهٔ اصلی تا فهرست قسمت‌ها و جست‌وجوی
          سریع. هرکدام را پسندیدی بگو همان را پیاده کنم؛ بقیه دست نمی‌خورند.
        </p>

        <div className="mt-5 max-w-md">
          <CommandPalette items={palette} />
        </div>

        <nav className="mt-5 flex flex-wrap gap-1.5">
          {[
            "قهرمان سینمایی",
            "ویترین بلور ۲",
            "کاورفلو",
            "ردیف کشسان",
            "کارت مایل",
            "کارت دوطرفه",
            "دستهٔ پوسترها",
            "تایم‌لاین قسمت‌ها",
            "سوییچ کیفیت",
            "پالت جست‌وجو",
            "حباب ژانرها",
            "ظهور تدریجی",
          ].map((label, index) => (
            <a
              key={label}
              href={`#d${index + 1}`}
              className="rounded-full border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold text-white/55 transition-colors hover:border-amber-400/35 hover:text-amber-200"
            >
              {faDigits(index + 1)} · {label}
            </a>
          ))}
        </nav>
      </header>

      <div className="grid min-w-0 max-w-full gap-y-12 lg:grid-cols-2 lg:gap-x-8">
        <Demo
          n={1}
          wide
          title="قهرمان سینمایی"
          source="Apple TV+"
          note="بنر با اسکرول آهسته‌تر از صفحه حرکت می‌کند، عنوان روی تصویر می‌نشیند و نوار شیشه‌ای پایین، اطلاعات و دکمه‌ها را نگه می‌دارد."
        >
          <HeroSpotlight anime={spotlight} />
        </Demo>

        <Demo
          n={2}
          wide
          title="ویترین بلور ۲"
          source="Netflix + Glass"
          note="نسخهٔ اصلاح‌شدهٔ ویترین: پوسترها دو برابر، رنگ بنرِ فعال با شدت ۸۵٪ پشت شیشه، تعویض خودکار هر ۶ ثانیه و خط کهربایی که پر می‌شود."
        >
          <ShelfVitrine title="محبوب‌ترین‌ها" note="بر اساس امتیاز" items={topRated} />
        </Demo>

        <Demo
          n={3}
          wide
          title="کاورفلو"
          source="Apple Music"
          note="ردیف مثل مسیر دوربین: کارت مرکز صاف می‌ایستد، دو طرف به داخل می‌چرخند و بقیه در تاریکی منتظر می‌مانند."
        >
          <ShelfCoverflow title="فیلم‌ها" note="یک‌قسمتی" items={movies} />
        </Demo>

        <Demo
          n={4}
          wide
          title="ردیف کشسان"
          source="Spotify"
          note="هر پوستر یک لبهٔ باریک است؛ با هاور باز می‌شود و بقیهٔ ردیف کنار می‌روند. روی موبایل با لمس باز می‌شود."
        >
          <RowElastic title="تازه‌ها" note="آخرین افزوده‌ها" items={latest} />
        </Demo>

        <Demo
          n={5}
          title="کارت مایل"
          source="Awwwards"
          note="پوستر به سمت نشانگر خم می‌شود، عنوان در عمق جلو می‌آید و یک درخشش روی شیشه می‌لغزد."
        >
          <div className="hide-scrollbar flex gap-4 overflow-x-auto pb-5 pt-1">
            {byScore.slice(0, 4).map((anime) => (
              <TiltCard key={anime.slug} anime={slim(anime)} />
            ))}
          </div>
        </Demo>

        <Demo
          n={6}
          title="کارت دوطرفه"
          source="Apple Wallet"
          note="روی کارت بزنی می‌چرخد: پشتش خلاصه، ژانر و دکمه‌های تماشا و علاقه‌مندی است."
        >
          <div className="hide-scrollbar flex gap-4 overflow-x-auto pb-5 pt-1">
            {flips.map((anime) => (
              <FlipCard key={anime.slug} anime={anime} />
            ))}
          </div>
        </Demo>

        <Demo
          n={7}
          title="دستهٔ پوسترها"
          source="Tinder + Netflix"
          note="پوسترها روی هم نشسته‌اند و هر چهار ثانیه یکی رو می‌شود؛ با دکمه‌های قبلی/بعدی هم می‌چرخد و با هاور می‌ایستد."
        >
          <DeckStack items={byScore.slice(2, 12).map(slim)} />
        </Demo>

        <Demo
          n={8}
          title="تایم‌لاین قسمت‌ها"
          source="Apple Podcasts"
          note="فهرست قسمت‌ها به‌جای جدول، یک ریل با نقطه است؛ هر قسمت همان‌جا باز می‌شود و کیفیت‌ها را نشان می‌دهد."
        >
          <EpisodeTimeline show={episodeSource.titleEn} episodes={episodes} />
        </Demo>

        <Demo
          n={9}
          title="سوییچ کیفیت"
          source="Vercel"
          note="یک انتخاب، چهار اندازه، با لنز کهربایی که می‌لغزد؛ عمل کپی هم همان‌جا تأیید می‌شود."
        >
          <QualitySwitch />
        </Demo>

        <Demo
          n={10}
          title="پالت جست‌وجو"
          source="Raycast / Linear"
          note="با ⌘K یا Ctrl+K باز می‌شود، با ↑↓ و ↵ کار می‌کند و روی موبایل از همین کادر بالای صفحه باز می‌شود."
        >
          <div className="rounded-[26px] border border-white/[0.11] bg-white/[0.025] p-4 backdrop-blur-md">
            <div className="max-w-md">
              <CommandPalette items={palette} shortcut={false} />
            </div>
            <p className="mt-3 text-[10.5px] leading-6 text-white/40">
              همین کادر را در هدر یا بالای صفحهٔ جست‌وجو می‌شود گذاشت؛ فهرستش از کاتالوگ واقعی
              می‌آید.
            </p>
          </div>
        </Demo>

        <Demo
          n={11}
          title="حباب ژانرها"
          source="Musicboard"
          note="هر ژانر یک حباب به اندازهٔ سهمش از کاتالوگ؛ آرام شنا می‌کند و با لمس فیلتر می‌شود."
        >
          <GenreBubbles genres={bubbleGenres} />
        </Demo>

        <Demo
          n={12}
          title="ظهور تدریجی"
          source="Next.js / Vercel"
          note="اسکلتِ هم‌شکل پوستر با درخشش، بعد تصویر از بلور بیرون می‌آید و کارت‌ها یکی‌یکی بالا می‌آیند."
        >
          <GridReveal items={byDate.slice(0, 8).map(slim)} />
        </Demo>
      </div>

      <footer className="mt-12 rounded-[24px] border border-white/[0.08] bg-white/[0.02] p-4 text-[11px] leading-6 text-white/40">
        همهٔ نمونه‌ها با دادهٔ واقعی کاتالوگ ساخته شده‌اند و روی همین آدرس جدا اجرا می‌شوند؛ هیچ
        کدام روی سایت اصلی اعمال نشده است.
      </footer>
    </div>
  );
}
