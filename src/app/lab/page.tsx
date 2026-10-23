import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FlaskConical, Sparkles } from "lucide-react";
import { ANIME } from "@/lib/data";
import type { HeroAnime } from "@/lib/catalog";
import { ShelfPocket } from "@/components/lab/shelf-pocket";
import { ShelfDeck } from "@/components/lab/shelf-deck";
import { ShelfVitrine } from "@/components/lab/shelf-vitrine";
import { ShelfMarquee } from "@/components/lab/shelf-marquee";

export const metadata: Metadata = {
  title: "آزمایشگاه اسکرول",
  description: "نمونه‌های پیشنهادی برای نوارهای افقی صفحهٔ اصلی.",
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

const withArt = ANIME.filter((anime) => Boolean(anime.cover));
const topRated = [...withArt].sort((a, b) => b.score - a.score).slice(0, 14).map(slim);
const latest = [...withArt]
  .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  .slice(0, 14)
  .map(slim);
const movies = withArt.filter((a) => a.type === "فیلم").slice(0, 12).map(slim);
const airing = withArt.filter((a) => a.status === "در حال پخش").slice(0, 14).map(slim);

function Sample({
  id,
  badge,
  title,
  note,
  children,
}: {
  id: string;
  badge: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-amber-400/30 bg-amber-400/10 text-[11px] font-black text-amber-300">
          {badge}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-black text-white">{title}</h2>
          <p className="mt-1 text-[11.5px] leading-6 text-content-muted">{note}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function LabPage() {
  return (
    <div className="shell py-8">
      <header className="mb-9 rounded-3xl border border-white/[0.1] bg-white/[0.035] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-center gap-2">
          <span className="chip border-amber-400/30 bg-amber-400/10 text-amber-300">
            <FlaskConical className="size-3.5" />
            پیش‌نمایش
          </span>
          <span className="chip">
            <Sparkles className="size-3.5 text-amber-300" />
            ۴ نمونه
          </span>
        </div>
        <h1 className="mt-3 text-xl font-black text-white sm:text-2xl">
          آزمایشگاه نوارهای افقی
        </h1>
        <p className="mt-2 max-w-2xl text-[12.5px] leading-7 text-content-muted">
          چهار برداشت از همان زبانِ فولدرِ علاقه‌مندی‌ها، برای نوارهای صفحهٔ اصلی. سایت اصلی دست
          نخورده؛ هر کدام را پسندیدی بگو همان را جایگزین کنم.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2">
          {[
            ["a", "الف · جیب شیشه‌ای"],
            ["b", "ب · بادبزن"],
            ["c", "پ · ویترین"],
            ["d", "ت · نوار روان"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="chip transition-colors hover:border-amber-400/40 hover:text-amber-200"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <div className="space-y-12 pb-10">
        <Sample
          id="a"
          badge="الف"
          title="جیب شیشه‌ای"
          note="همان فولدرِ علاقه‌مندی‌ها، افقی: برچسب روی زبانه، پوسترها ایستاده در جیب، لبهٔ مه‌آلود پایین و خط کهربایی که با اسکرول پر می‌شود."
        >
          <ShelfPocket title="محبوب‌ترین‌ها" note="۱۴ عنوان" items={topRated} />
        </Sample>

        <Sample
          id="b"
          badge="ب"
          title="بادبزن"
          note="کارت‌ها مثل برگه‌های داخل پوشه روی هم می‌افتند، هر یک کمی کج؛ هر کارتی که لمس کنی از دسته بیرون می‌آید."
        >
          <ShelfDeck title="تازه‌ها" note="آخرین افزوده‌ها" items={latest} />
        </Sample>

        <Sample
          id="c"
          badge="پ"
          title="ویترین بلور"
          note="پوسترِ فعال، شیشهٔ پشت ویترین را رنگ می‌زند؛ عنوان و امتیاز بالای قاب می‌آید و ردیف پایین باریک می‌ماند."
        >
          <ShelfVitrine title="فیلم‌ها" note="یک‌قسمتی" items={movies} />
        </Sample>

        <Sample
          id="d"
          badge="ت"
          title="نوار روان"
          note="دو ردیف آرام در دو جهت مخالف می‌لغزند و با لمس یا هاور می‌ایستند؛ برای بخش‌های «پیشنهاد» یا «در حال پخش»."
        >
          <ShelfMarquee title="در حال پخش" note="این هفته" items={airing} />
        </Sample>
      </div>
    </div>
  );
}
