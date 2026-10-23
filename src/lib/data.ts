import realCatalog from "./real-catalog.json";

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
  nextEpisodeAt?: string;
  cover?: string;
  banner?: string;
  source?: "demo" | "aniplus";
  aniplusId?: string;
  watchUrl?: string;
  episodeData?: EpisodeData[];
};

const BASE_SITE = {
  name: "انیمه‌ورس",
  nameEn: "AnimeVerse",
  tagline: "جهانی برای دیدن و دانلود انیمه",
  description:
    "دانلود انیمه با زیرنویس فارسی و دوبله، کیفیت ۱۰۸۰p و x265؛ آرشیوی بی‌پایان از سریال‌ها و فیلم‌های محبوب، همراه با لینک مستقیم و پرسرعت.",
  telegram: "https://t.me/testanivers",
  telegramHandle: "@testanivers",
  memberCount: 28400,
  titleCount: 2480,
  episodeCount: 38600,
} as const;

const iso = (daysAgo: number, hoursAgo = 0) =>
  new Date(Date.parse("2026-10-19T20:00:00Z") - daysAgo * 86400000 - hoursAgo * 3600000).toISOString();

const DEMO_ANIME: Anime[] = [
  {
    slug: "frieren",
    title: "سفر فریرن",
    titleEn: "Frieren: Beyond Journey's End",
    titleJa: "葬送のフリーレン",
    year: 2023,
    season: "پاییز",
    score: 9.2,
    votes: 184320,
    episodes: 28,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "Madhouse",
    genres: ["فانتزی", "ماجراجویی", "درام"],
    synopsis:
      "پس از پایان سفر قهرمانان و مرگ هیمل، جادوگر جاودانه فریرن تازه می‌فهمد که یک دهه در کنار انسان‌ها برایش به اندازهٔ یک چشم‌برهم‌زدن بوده است. او راه می‌افتد تا آدم‌ها را بفهمد، خاطره‌ها را زنده نگه دارد و معنای زمان را در مسیرهای تازه پیدا کند.",
    tagline: "زمان برای جادوگر معنا ندارد؛ برای انسان‌ها همه‌چیز است.",
    art: { from: "#2c3f8f", to: "#8fe3d9", accent: "#b7f7e6", glyph: "葬送" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    featured: true,
    weeklyViews: 921000,
    popularity: 98,
    updatedAt: iso(0, 2),
  },
  {
    slug: "jujutsu-kaisen",
    title: "جوجوتسو کایزن",
    titleEn: "Jujutsu Kaisen",
    titleJa: "呪術廻戦",
    year: 2020,
    season: "پاییز",
    score: 8.8,
    votes: 265100,
    episodes: 47,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "MAPPA",
    genres: ["اکشن", "ماورایی", "فانتزی"],
    synopsis:
      "یوجی ایتادوری با بلعیدن انگشت یک موجود نفرین‌شده، میزبان قدرتمندترین روح نفرین تاریخ می‌شود. حالا او باید در مدرسهٔ جادوی توکیو یاد بگیرد نفرین‌ها را شکار کند، پیش از آن‌که خودش به بزرگ‌ترین نفرین جهان تبدیل شود.",
    tagline: "نفرین را با نفرین شکست می‌دهند.",
    art: { from: "#161c4b", to: "#7b3ff2", accent: "#c4b5fd", glyph: "呪術" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+16",
    featured: true,
    rank: 6,
    weeklyViews: 784000,
    popularity: 96,
    updatedAt: iso(1, 4),
  },
  {
    slug: "demon-slayer",
    title: "شیطان‌کش",
    titleEn: "Demon Slayer: Kimetsu no Yaiba",
    titleJa: "鬼滅の刃",
    year: 2019,
    season: "بهار",
    score: 8.9,
    votes: 301240,
    episodes: 63,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "ufotable",
    genres: ["اکشن", "ماورایی", "تاریخی"],
    synopsis:
      "تنجیرو کامادو پس از قتل‌عام خانواده‌اش و تبدیل شدن خواهرش به شیطان، شمشیرزن می‌شود تا نفرین خونش را بشکند. شمشیر و نفس، دو سلاح او در نبردی بی‌پایان با شب‌زندگان است.",
    tagline: "نفس بکش، حتی وقتی همه‌چیز تمام شده.",
    art: { from: "#04211f", to: "#0ea5a4", accent: "#5eead4", glyph: "鬼滅" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+16",
    rank: 7,
    weeklyViews: 655000,
    popularity: 95,
    updatedAt: iso(0, 7),
  },
  {
    slug: "attack-on-titan",
    title: "حمله به تایتان",
    titleEn: "Attack on Titan",
    titleJa: "進撃の巨人",
    year: 2013,
    season: "بهار",
    score: 9.1,
    votes: 412800,
    episodes: 87,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "WIT / MAPPA",
    genres: ["اکشن", "درام", "فانتزی"],
    synopsis:
      "بشریت پشت دیوارهایی بلند از تایتان‌های آدم‌خوار پناه گرفته است؛ تا روزی که دیوار می‌شکند. ارن یگر با نفرت و آرزوی آزادی وارد ارتش می‌شود و پرده از رازی برمی‌دارد که دنیا را برای همیشه تغییر می‌دهد.",
    tagline: "آزادی، بهای سنگینی دارد.",
    art: { from: "#2a1307", to: "#b45309", accent: "#fbbf24", glyph: "進撃" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+18",
    rank: 1,
    weeklyViews: 612000,
    popularity: 99,
    updatedAt: iso(4),
  },
  {
    slug: "solo-leveling",
    title: "سولو لولینگ",
    titleEn: "Solo Leveling",
    titleJa: "俺だけレベルアップな件",
    year: 2024,
    season: "زمستان",
    score: 8.6,
    votes: 152300,
    episodes: 25,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "A-1 Pictures",
    genres: ["اکشن", "فانتزی", "ماجراجویی"],
    synopsis:
      "شکارچی رتبهٔ E، سونگ جین‌وو، در دنیایی که دروازه‌ها به هیولاها باز می‌شوند ضعیف‌ترین است؛ تا سیستم مرموزی تصمیم می‌گیرد فقط او را لِوِل‌آپ کند. هر بار که نزدیک مرگ می‌رود، قوی‌تر برمی‌گردد.",
    tagline: "ضعیف‌ترین شکارچی، تنها بازیکن سیستم است.",
    art: { from: "#07143a", to: "#2563eb", accent: "#7dd3fc", glyph: "影" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+16",
    weeklyViews: 590000,
    popularity: 93,
    updatedAt: iso(0, 11),
  },
  {
    slug: "one-piece",
    title: "وان پیس",
    titleEn: "One Piece",
    titleJa: "ワンピース",
    year: 1999,
    season: "پاییز",
    score: 9.0,
    votes: 389400,
    episodes: 1122,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "Toei Animation",
    genres: ["ماجراجویی", "اکشن", "کمدی"],
    synopsis:
      "لوفی و خدمهٔ کلاه‌حصیری در دریای بزرگ به دنبال گنج افسانه‌ای وان‌پیس می‌گردند. هر جزیره یک داستان است و هر داستان، یک قدم نزدیک‌تر به رؤیای پادشاه دزدان دریایی شدن.",
    tagline: "ماجراجویی تمام نمی‌شود؛ فقط گسترده‌تر می‌شود.",
    art: { from: "#03283f", to: "#0ea5e9", accent: "#fde047", glyph: "海賊" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+12",
    rank: 5,
    weeklyViews: 511000,
    popularity: 94,
    updatedAt: iso(0, 5),
  },
  {
    slug: "chainsaw-man",
    title: "مرد اره‌شنی",
    titleEn: "Chainsaw Man",
    titleJa: "チェンソーマン",
    year: 2022,
    season: "پاییز",
    score: 8.6,
    votes: 198650,
    episodes: 12,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "MAPPA",
    genres: ["اکشن", "ترسناک", "ماورایی"],
    synopsis:
      "دنجی، پسری بدهکار و تنها، با شیطان اره‌برقی زندگی می‌کند تا روزی که کشته می‌شود و با قلب شیطان دوباره به دنیا برمی‌گردد. حالا او ابزار دولتی شکار شیاطین است و رؤیایش ساده‌تر از آن است که فکرش را می‌کنید.",
    tagline: "رؤیاهای کوچک، خون‌های بزرگ.",
    art: { from: "#2b0912", to: "#e11d48", accent: "#fda4af", glyph: "電鋸" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+18",
    weeklyViews: 402000,
    popularity: 90,
    updatedAt: iso(8),
  },
  {
    slug: "vinland-saga",
    title: "وینلند ساگا",
    titleEn: "Vinland Saga",
    titleJa: "ヴィンランド・サガ",
    year: 2019,
    season: "تابستان",
    score: 8.8,
    votes: 143200,
    episodes: 48,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "WIT / MAPPA",
    genres: ["تاریخی", "درام", "اکشن"],
    synopsis:
      "تورفین در دنیای وایکینگ‌ها با کینهٔ پدرش بزرگ می‌شود و در نبردها به دنبال انتقام است. اما هرچه دورتر می‌رود، بیشتر می‌فهمد که جنگ پاسخ هیچ‌چیز نیست و سرزمینی آرام به نام وینلند شاید فقط در ذهن آدم‌ها وجود داشته باشد.",
    tagline: "شمشیر را زمین بگذار تا انسان شوی.",
    art: { from: "#0c231c", to: "#0d9488", accent: "#99f6e4", glyph: "戦士" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی"],
    ageRating: "+16",
    rank: 10,
    weeklyViews: 298000,
    popularity: 88,
    updatedAt: iso(12),
  },
  {
    slug: "cyberpunk-edgerunners",
    title: "سایبرپانک: ادجرانرز",
    titleEn: "Cyberpunk: Edgerunners",
    titleJa: "サイバーパンク エッジランナーズ",
    year: 2022,
    season: "پاییز",
    score: 8.6,
    votes: 176500,
    episodes: 10,
    duration: "۲۵ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "Studio Trigger",
    genres: ["علمی-تخیلی", "اکشن", "درام"],
    synopsis:
      "در نایت‌سیتی، شهری که بدن آدم‌ها را می‌فروشد، دیوید مارتینز جوان پس از از دست دادن همه‌چیز به دنیای ادجرانرها کشیده می‌شود. نسخه‌های آپگرید، رویاهای بزرگ و بهایی که هیچ‌کس نمی‌خواهد بپردازد.",
    tagline: "در نایت‌سیتی هیچ‌کس قهرمان به دنیا نمی‌آید.",
    art: { from: "#190d3c", to: "#d946ef", accent: "#22d3ee", glyph: "電脳" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+18",
    featured: true,
    weeklyViews: 356000,
    popularity: 89,
    updatedAt: iso(20),
  },
  {
    slug: "bocchi-the-rock",
    title: "بوچی د راک",
    titleEn: "Bocchi the Rock!",
    titleJa: "ぼっち・ざ・ろっく！",
    year: 2022,
    season: "پاییز",
    score: 8.8,
    votes: 98700,
    episodes: 12,
    duration: "۲۳ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "CloverWorks",
    genres: ["کمدی", "موسیقی", "روزمره"],
    synopsis:
      "هیتوری گوتو، گیتاریست با استعداد اما به‌شدت کم‌رو، تصمیم می‌گیرد با عضویت در یک گروه دانشگاهی از اتاقش بیرون بیاید. مشکل این است که حتی سلام کردن به فروشندهٔ مغازه هم برایش یک نبرد حماسی است.",
    tagline: "روی صحنه، حتی اگر دستت می‌لرزد.",
    art: { from: "#2b0f2e", to: "#ec4899", accent: "#fbcfe8", glyph: "結束" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی"],
    ageRating: "+12",
    weeklyViews: 210000,
    popularity: 84,
    updatedAt: iso(25),
  },
  {
    slug: "spy-x-family",
    title: "جاسوس × خانواده",
    titleEn: "Spy x Family",
    titleJa: "スパイファミリー",
    year: 2022,
    season: "بهار",
    score: 8.5,
    votes: 167800,
    episodes: 37,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "WIT / CloverWorks",
    genres: ["کمدی", "اکشن", "روزمره"],
    synopsis:
      "یک جاسوس برای انجام مأموریتش باید خانواده‌ای جعلی بسازد؛ همسرش قاتل حرفه‌ای است و دخترش تله‌پات می‌خواند. هیچ‌کدام از این سه نفر نمی‌دانند دیگری چیست، اما همه‌شان کم‌کم یاد می‌گیرند یک خانوادهٔ واقعی باشند.",
    tagline: "مأموریت: یک خانوادهٔ معمولی.",
    art: { from: "#07251d", to: "#10b981", accent: "#fde68a", glyph: "諜報" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+12",
    weeklyViews: 289000,
    popularity: 86,
    updatedAt: iso(1, 9),
  },
  {
    slug: "death-note",
    title: "دفترچه مرگ",
    titleEn: "Death Note",
    titleJa: "デスノート",
    year: 2006,
    season: "پاییز",
    score: 9.0,
    votes: 356700,
    episodes: 37,
    duration: "۲۳ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "Madhouse",
    genres: ["معمایی", "روانشناختی", "ماورایی"],
    synopsis:
      "لایت یگامی دانش‌آموزی ممتاز است که دفترچه‌ای پیدا می‌کند؛ هر اسمی که در آن نوشته شود، می‌میرد. او عدالتی جدید می‌سازد و کارآگاهی ناشناس به نام L وارد بازی می‌شود؛ بازی‌ای که تنها یک برنده دارد.",
    tagline: "عدالت، وقتی از دست انسان بیفتد چه شکلی است؟",
    art: { from: "#090909", to: "#7f1d1d", accent: "#fca5a5", glyph: "死" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+16",
    rank: 4,
    weeklyViews: 334000,
    popularity: 92,
    updatedAt: iso(60),
  },
  {
    slug: "fullmetal-alchemist",
    title: "کیمیاگر تمام‌فلزی",
    titleEn: "Fullmetal Alchemist: Brotherhood",
    titleJa: "鋼の錬金術師",
    year: 2009,
    season: "بهار",
    score: 9.2,
    votes: 402100,
    episodes: 64,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "Bones",
    genres: ["ماجراجویی", "فانتزی", "درام"],
    synopsis:
      "ادوارد و آلفونس الریک با کیمیاگری بدن‌هایشان را از دست داده‌اند و در جست‌وجوی سنگ فیلسوف به سراسر آمستریس سفر می‌کنند. هر قدم آن‌ها را به رازی می‌رساند که پشت تمام جنگ‌ها و سیاست‌های کشور پنهان شده است.",
    tagline: "برای به‌دست آوردن چیزی، باید چیزی برابر بدهی.",
    art: { from: "#1c1917", to: "#b45309", accent: "#fcd34d", glyph: "錬金" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    rank: 3,
    weeklyViews: 321000,
    popularity: 97,
    updatedAt: iso(90),
  },
  {
    slug: "hunter-x-hunter",
    title: "هانتر × هانتر",
    titleEn: "Hunter x Hunter",
    titleJa: "ハンター×ハンター",
    year: 2011,
    season: "پاییز",
    score: 9.0,
    votes: 287300,
    episodes: 148,
    duration: "۲۳ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "Madhouse",
    genres: ["ماجراجویی", "اکشن", "فانتزی"],
    synopsis:
      "گون فریکس برای پیدا کردن پدرش در آزمون هانترها شرکت می‌کند؛ آزمونی که آدم‌های خطرناک و قوانین عجیبش فقط شروع ماجراست. در این دنیا، قدرت واقعی نه در مشت، که در فهمیدن قواعد بازی است.",
    tagline: "هر توانایی، یک قانون دارد.",
    art: { from: "#0e2417", to: "#16a34a", accent: "#86efac", glyph: "狩人" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    rank: 8,
    weeklyViews: 264000,
    popularity: 91,
    updatedAt: iso(120),
  },
  {
    slug: "naruto-shippuden",
    title: "ناروتو شیپودن",
    titleEn: "Naruto: Shippuden",
    titleJa: "ナルト 疾風伝",
    year: 2007,
    season: "زمستان",
    score: 8.7,
    votes: 332900,
    episodes: 500,
    duration: "۲۳ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "Pierrot",
    genres: ["اکشن", "ماجراجویی", "فانتزی"],
    synopsis:
      "ناروتو پس از دو سال تمرین به دهکده برمی‌گردد؛ دهکده‌ای که هنوز زخم‌هایش تازه است و سازمانی مرموز به نام آکاتسوکی در تعقیب جینچوریکی‌هاست. این بار رؤیای هوکاگه شدن بهای سنگین‌تری دارد.",
    tagline: "هر نسل، راه خودش را پیدا می‌کند.",
    art: { from: "#2a1306", to: "#ea580c", accent: "#fdba74", glyph: "忍" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    weeklyViews: 245000,
    popularity: 87,
    updatedAt: iso(600),
  },
  {
    slug: "my-hero-academia",
    title: "آکادمی قهرمان من",
    titleEn: "My Hero Academia",
    titleJa: "僕のヒーローアカデミア",
    year: 2016,
    season: "بهار",
    score: 8.3,
    votes: 214600,
    episodes: 159,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "Bones",
    genres: ["اکشن", "ابرقهرمانی", "کمدی"],
    synopsis:
      "در دنیایی که بیشتر آدم‌ها قدرت خاص دارند، اِیزوکو Midoriya بدون هیچ قدرتی به دنیا آمده است. اما ملاقات با قهرمان شماره یک، او را به بزرگ‌ترین مدرسهٔ قهرمان‌سازی می‌رساند؛ جایی که باید ثابت کند قهرمانی به قدرت نیست.",
    tagline: "قهرمان شدن، انتخاب است.",
    art: { from: "#0d2347", to: "#dc2626", accent: "#93c5fd", glyph: "英雄" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    weeklyViews: 198000,
    popularity: 85,
    updatedAt: iso(2, 3),
  },
  {
    slug: "blue-lock",
    title: "بلو لاک",
    titleEn: "Blue Lock",
    titleJa: "ブルーロック",
    year: 2022,
    season: "پاییز",
    score: 8.2,
    votes: 126400,
    episodes: 38,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "8bit",
    genres: ["ورزشی", "درام", "اکشن"],
    synopsis:
      "فدراسیون فوتبال ژاپن ۳۰۰ مهاجم جوان را در اردوگاهی بسته حبس می‌کند تا از میانشان یک «خودخواه» کامل بسازد. ایساگی یوئیچی باید یاد بگیرد برای گل زدن، به هم‌تیمی‌هایش هم رحم نکند.",
    tagline: "فوتبال، میدان خودخواه‌هاست.",
    art: { from: "#071b36", to: "#0284c7", accent: "#67e8f9", glyph: "蹴" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی"],
    ageRating: "+12",
    weeklyViews: 176000,
    popularity: 80,
    updatedAt: iso(0, 14),
  },
  {
    slug: "oshi-no-ko",
    title: "فرزند ستاره",
    titleEn: "Oshi no Ko",
    titleJa: "【推しの子】",
    year: 2023,
    season: "بهار",
    score: 8.7,
    votes: 142900,
    episodes: 24,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "Doga Kobo",
    genres: ["درام", "معمایی", "روانشناختی"],
    synopsis:
      "پزشکی که شیفتهٔ یک آیدول بود، پس از مرگی غیرمنتظره به‌عنوان فرزند دوقلوی همان آیدول به دنیا می‌آید. دنیای درخشان صنعت سرگرمی، از پشت صحنه چهرهٔ دیگری دارد و او آمده تا حقیقت را پیدا کند.",
    tagline: "دروغ، درخشان‌ترین سلاح یک آیدول است.",
    art: { from: "#1a1034", to: "#a855f7", accent: "#f9a8d4", glyph: "星" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی"],
    ageRating: "+16",
    weeklyViews: 188000,
    popularity: 83,
    updatedAt: iso(0, 18),
  },
  {
    slug: "dandadan",
    title: "دان‌دادان",
    titleEn: "Dandadan",
    titleJa: "ダンダダン",
    year: 2024,
    season: "پاییز",
    score: 8.6,
    votes: 89700,
    episodes: 24,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "Science SARU",
    genres: ["اکشن", "کمدی", "ماورایی"],
    synopsis:
      "دختری که به ارواح اعتقاد دارد و پسری که به موجودات فضایی باور دارد، در یک شب هر دو گرفتار چیزی می‌شوند که هیچ‌کدام پیش‌بینی نمی‌کردند. حالا باید با هم از پس نیروهایی بربیایند که دوست‌داشتنی‌تر از حد انتظارند.",
    tagline: "باور نداشته باش، اما فرار کن.",
    art: { from: "#1c0e2c", to: "#f43f5e", accent: "#fde047", glyph: "怪異" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی"],
    ageRating: "+16",
    weeklyViews: 173000,
    popularity: 82,
    updatedAt: iso(0, 21),
  },
  {
    slug: "kaiju-no-8",
    title: "کایجو شمارهٔ ۸",
    titleEn: "Kaiju No. 8",
    titleJa: "怪獣8号",
    year: 2024,
    season: "بهار",
    score: 8.1,
    votes: 103500,
    episodes: 24,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "Production I.G",
    genres: ["اکشن", "علمی-تخیلی", "کایجو"],
    synopsis:
      "کافکا هیبی‌نو، کارگر پاک‌سازی لاشهٔ هیولاها، آرزو دارد عضو نیروی دفاعی شود. یک شب موجودی عجیب وارد بدنش می‌شود و او به هیولایی تبدیل می‌شود که خودش باید شکارش کند.",
    tagline: "هیولا شکار کن، هیولا نباش.",
    art: { from: "#0f1b16", to: "#65a30d", accent: "#bef264", glyph: "怪獣" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+16",
    weeklyViews: 149000,
    popularity: 79,
    updatedAt: iso(3),
  },
  {
    slug: "mushoku-tensei",
    title: "تولد دوبارهٔ بیکار",
    titleEn: "Mushoku Tensei: Jobless Reincarnation",
    titleJa: "無職転生",
    year: 2021,
    season: "زمستان",
    score: 8.4,
    votes: 118200,
    episodes: 35,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "Studio Bind",
    genres: ["ایسکای", "فانتزی", "ماجراجویی"],
    synopsis:
      "مردی ۳۴ ساله که زندگی‌اش را هدر داده، پس از مرگ در دنیایی جادویی به دنیا می‌آید. این بار او با استعداد است و تصمیم دارد از صفر شروع کند؛ اما scars گذشته با تغییر دنیا پاک نمی‌شوند.",
    tagline: "یک زندگی تازه، هنوز هم زندگی است.",
    art: { from: "#17102c", to: "#6366f1", accent: "#a5b4fc", glyph: "転生" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+18",
    weeklyViews: 137000,
    popularity: 78,
    updatedAt: iso(1, 12),
  },
  {
    slug: "re-zero",
    title: "ری:زیرو",
    titleEn: "Re:Zero - Starting Life in Another World",
    titleJa: "Re:ゼロから始める異世界生活",
    year: 2016,
    season: "بهار",
    score: 8.5,
    votes: 189100,
    episodes: 50,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "در حال پخش",
    studio: "White Fox",
    genres: ["ایسکای", "درام", "فانتزی"],
    synopsis:
      "سوبارو ناتسوکی در دنیای دیگری بیدار می‌شود و خیلی زود می‌فهمد هر بار که می‌میرد، به نقطهٔ شروع برمی‌گردد. برای نجات آدم‌هایی که دوستشان دارد، باید مرگ را بارها و بارها تجربه کند.",
    tagline: "شروع دوباره، همیشه فرصت نیست؛ گاهی مجازات است.",
    art: { from: "#1a0f2f", to: "#7c3aed", accent: "#c4b5fd", glyph: "輪廻" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+16",
    weeklyViews: 129000,
    popularity: 77,
    updatedAt: iso(4, 2),
  },
  {
    slug: "steins-gate",
    title: "دروازهٔ اشتاینز",
    titleEn: "Steins;Gate",
    titleJa: "シュタインズ・ゲート",
    year: 2011,
    season: "بهار",
    score: 9.0,
    votes: 301600,
    episodes: 24,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "White Fox",
    genres: ["علمی-تخیلی", "معمایی", "درام"],
    synopsis:
      "اوکابه رینتارو، دانشمند دیوانه‌ای که ادعا می‌کند دنیا را تغییر می‌دهد، تصادفی دستگاهی می‌سازد که می‌تواند پیام به گذشته بفرستد. هر پیام کوچک، خط زمانی را می‌شکند و بهایی دارد که او آماده‌اش نیست.",
    tagline: "زمان خطی نیست؛ تار است.",
    art: { from: "#191520", to: "#7c2d12", accent: "#fed7aa", glyph: "時" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+16",
    rank: 9,
    weeklyViews: 121000,
    popularity: 90,
    updatedAt: iso(200),
  },
  {
    slug: "violet-evergarden",
    title: "ویولت اورگاردن",
    titleEn: "Violet Evergarden",
    titleJa: "ヴァイオレット・エヴァーガーデン",
    year: 2018,
    season: "زمستان",
    score: 8.9,
    votes: 172400,
    episodes: 13,
    duration: "۲۴ دقیقه",
    type: "سریال",
    status: "پایان یافته",
    studio: "Kyoto Animation",
    genres: ["درام", "عاشقانه", "فانتزی"],
    synopsis:
      "ویولت، سربازی که تنها برای جنگ ساخته شده، پس از پایان جنگ به کار نوشتن نامه برای دیگران مشغول می‌شود. او کلماتی را پیدا می‌کند که خودش هرگز بلد نبود بگوید: دوستت دارم.",
    tagline: "بعضی جمله‌ها را باید برای دیگری نوشت.",
    art: { from: "#1b1533", to: "#6d28d9", accent: "#fbcfe8", glyph: "手紙" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    weeklyViews: 98000,
    popularity: 81,
    updatedAt: iso(400),
  },
  {
    slug: "your-name",
    title: "اسم تو",
    titleEn: "Your Name.",
    titleJa: "君の名は。",
    year: 2016,
    season: "تابستان",
    score: 8.8,
    votes: 268900,
    episodes: 1,
    duration: "۱۰۶ دقیقه",
    type: "فیلم",
    status: "پایان یافته",
    studio: "CoMix Wave Films",
    genres: ["عاشقانه", "فانتزی", "درام"],
    synopsis:
      "میتسوها دختری در شهرستانی دورافتاده و تاکی پسر نوجوانی در توکیو، بدون هیچ توضیحی جای خوابشان را با هم عوض می‌کنند. وقتی فاصلهٔ زمانی میان‌شان آشکار می‌شود، پیدا کردن یکدیگر به مسابقه‌ای با سرنوشت تبدیل می‌شود.",
    tagline: "یک نام، برای پیدا کردن دوباره.",
    art: { from: "#081c38", to: "#f472b6", accent: "#fde68a", glyph: "君" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    weeklyViews: 115000,
    popularity: 89,
    updatedAt: iso(500),
  },
  {
    slug: "suzume",
    title: "سوزومه",
    titleEn: "Suzume",
    titleJa: "すずめの戸締まり",
    year: 2022,
    season: "پاییز",
    score: 8.0,
    votes: 84200,
    episodes: 1,
    duration: "۱۲۲ دقیقه",
    type: "فیلم",
    status: "پایان یافته",
    studio: "CoMix Wave Films",
    genres: ["فانتزی", "ماجراجویی", "درام"],
    synopsis:
      "سوزومه دختر هفده‌ساله‌ای است که در مسیر رفتن به مدرسه با جوانی عجیب روبه‌رو می‌شود و درِ فروریخته‌ای را در کوهستان باز می‌کند. از آن روز به بعد، باید درهای فاجعه را در سراسر ژاپن ببندد.",
    tagline: "هر در، پشتش یک خاطره است.",
    art: { from: "#06252b", to: "#0d9488", accent: "#fde68a", glyph: "扉" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+12",
    weeklyViews: 72000,
    popularity: 74,
    updatedAt: iso(380),
  },
  {
    slug: "a-silent-voice",
    title: "صدای سکوت",
    titleEn: "A Silent Voice",
    titleJa: "聲の形",
    year: 2016,
    season: "پاییز",
    score: 8.9,
    votes: 196300,
    episodes: 1,
    duration: "۱۳۰ دقیقه",
    type: "فیلم",
    status: "پایان یافته",
    studio: "Kyoto Animation",
    genres: ["درام", "عاشقانه", "روزمره"],
    synopsis:
      "شویا که در دوران کودکی دختر ناشنوایی را آزار داده، سال‌ها بعد به دنبال بخشش می‌گردد. داستانی آرام دربارهٔ زخم‌هایی که حرف زدن با آن‌ها سخت است و دوستی که باید از نو ساخته شود.",
    tagline: "شنیدن، فقط با گوش نیست.",
    art: { from: "#1d1b4b", to: "#38bdf8", accent: "#fbcfe8", glyph: "聲" },
    quality: ["4K", "1080p", "720p"],
    audio: ["زیرنویس فارسی", "دوبله"],
    ageRating: "+13",
    weeklyViews: 88000,
    popularity: 84,
    updatedAt: iso(520),
  },
  {
    slug: "perfect-blue",
    title: "آبی کامل",
    titleEn: "Perfect Blue",
    titleJa: "パーフェクトブルー",
    year: 1997,
    season: "زمستان",
    score: 8.6,
    votes: 107800,
    episodes: 1,
    duration: "۸۱ دقیقه",
    type: "فیلم",
    status: "پایان یافته",
    studio: "Madhouse",
    genres: ["روانشناختی", "معمایی", "ترسناک"],
    synopsis:
      "میما، خوانندهٔ محبوبی که می‌خواهد بازیگر شود، در مرز میان واقعیت و توهم گرفتار می‌شود. کسی زندگی‌اش را تعقیب می‌کند و نسخهٔ دیگری از او، در آینه، همه‌چیز را از او می‌گیرد.",
    tagline: "آینه، همیشه حقیقت را نشان نمی‌دهد.",
    art: { from: "#0f172a", to: "#1d4ed8", accent: "#f472b6", glyph: "夢" },
    quality: ["1080p", "720p", "480p"],
    audio: ["زیرنویس فارسی"],
    ageRating: "+18",
    weeklyViews: 64000,
    popularity: 76,
    updatedAt: iso(900),
  },
];

const REAL_ANIME = Array.isArray(realCatalog) ? (realCatalog as unknown as Anime[]) : [];
export const ANIME: Anime[] = REAL_ANIME.length ? REAL_ANIME : DEMO_ANIME;

export const SITE = {
  ...BASE_SITE,
  titleCount: ANIME.length,
  episodeCount: ANIME.reduce(
    (total, anime) => total + (anime.availableEpisodes ?? anime.episodes),
    0,
  ),
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
  { name: "روانشناختی", en: "Psychological", from: "#6d28d9", to: "#db2777", icon: "brain" },
  { name: "ورزشی", en: "Sports", from: "#22c55e", to: "#0ea5e9", icon: "trophy" },
  { name: "موسیقی", en: "Music", from: "#ec4899", to: "#f59e0b", icon: "music" },
  { name: "ایسکای", en: "Isekai", from: "#6366f1", to: "#10b981", icon: "door" },
] as const;

export const YEAR_OPTIONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2016, 2014, 2011, 2009, 2006, 1999] as const;

export function getAnime(slug: string): Anime | undefined {
  return ANIME.find((a) => a.slug === slug);
}

export function getFeatured(): Anime[] {
  return ANIME.filter((a) => a.featured);
}

export function getTopTen(): Anime[] {
  return [...ANIME].filter((a) => a.rank).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

export function getLatest(limit = 12): Anime[] {
  return [...ANIME].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

/** Latest title always stays in the hero; the other slides rotate at Tehran midnight. */
export function getDailyHero(limit = 3): Anime[] {
  const latest = getLatest(Math.max(limit + 4, 9));
  if (latest.length <= limit) return latest;

  const day = tehranDay();

  const [newest, ...rest] = latest;
  const out = [newest];
  const start = day % rest.length;
  for (let i = 0; out.length < limit; i += 1) {
    out.push(rest[(start + i) % rest.length]);
  }
  return out;
}

/** The day number all "daily" home sections rotate on (Tehran midnight). */
export function tehranDay(): number {
  let day = Math.floor(Date.now() / 86_400_000);
  try {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const midnight = Date.parse(`${key}T00:00:00Z`);
    if (Number.isFinite(midnight)) day = Math.floor(midnight / 86_400_000);
  } catch {
    // Keep the UTC fallback if the runtime has no Tehran timezone data.
  }
  return day;
}

/**
 * The hero's popular line-up. Every slide is re-drawn at Tehran midnight: the
 * popular pool is cut into blocks the size of the line-up and the day picks the
 * block, so today's five are all replaced by tomorrow's five.
 */
export function getDailyPopularHero(limit = 5): Anime[] {
  const pool = getPopular(Math.max(limit * 4, 20));
  if (pool.length <= limit) return pool;

  const offset = (((tehranDay() * limit) % pool.length) + pool.length) % pool.length;
  const out: Anime[] = [];
  for (let i = 0; i < limit; i += 1) out.push(pool[(offset + i) % pool.length]);
  return out;
}

/** Split quality labels into readable base badges and the x265 codec family. */
export function splitQualities(qualities: string[]) {
  const unique = Array.from(new Set(qualities));
  return {
    base: unique.filter((quality) => !/x265/i.test(quality)),
    x265: unique.some((quality) => /x265/i.test(quality)),
    all: unique,
  };
}

export function getPopular(limit = 12): Anime[] {
  return [...ANIME].sort((a, b) => b.weeklyViews - a.weeklyViews).slice(0, limit);
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

export function getChineseAnime(limit = 12): Anime[] {
  return [...ANIME]
    .filter(isChineseAnime)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

// A few archive-only films arrive from AniPlus with an empty/incorrect type
// field. Keep them in the cinema rail without guessing from episode count
// (which would also turn TV specials into films).
const EXTRA_MOVIE_SLUGS = new Set([
  "tokyo-godfathers",
  "virgin-punk-clockwork-girl",
  "all-you-need-is-kill",
  "build-divide-code-white",
  "scarlet",
]);

export function getMovies(limit = 12): Anime[] {
  return [...ANIME]
    .filter((anime) => anime.type === "فیلم" || EXTRA_MOVIE_SLUGS.has(anime.slug))
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function getEditorsPick(limit = 4): Anime[] {
  return [...ANIME].sort((a, b) => b.popularity - a.popularity).slice(0, limit);
}

function hashString(value: string) {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededShuffle<T extends { slug: string }>(items: T[], seed: string): T[] {
  return items
    .map((item) => ({ item, key: hashString(`${seed}:${item.slug}`) }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

export function getRelated(anime: Anime, limit = 6): Anime[] {
  const others = ANIME.filter((a) => a.slug !== anime.slug);
  const similar = others
    .map((a) => ({
      anime: a,
      shared: a.genres.filter((g) => anime.genres.includes(g)).length,
    }))
    .filter((item) => item.shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        Math.abs(a.anime.score - anime.score) - Math.abs(b.anime.score - anime.score) ||
        b.anime.popularity - a.anime.popularity,
    )
    .slice(0, limit)
    .map((item) => item.anime);

  const picked = new Set(similar.map((item) => item.slug));
  const randomFill = seededShuffle(
    others.filter((item) => !picked.has(item.slug)),
    anime.slug,
  );

  return [...similar, ...randomFill].slice(0, limit);
}

export type Episode = {
  number: number;
  title: string;
  runtime: string;
  releasedAt: string;
  filler?: boolean;
  qualities?: EpisodeQuality[];
};

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
  "خاطرهٔ گم‌شده",
  "سرنوشت",
];

// Kept in one place: the client-side episode list and the server both use the
// same deterministic generator from catalog.ts.
export { getEpisodes } from "./catalog";

export function getGenreCount(name: string): number {
  return ANIME.filter((a) => a.genres.includes(name)).length;
}

export function getGenreSlug(name: string): string {
  return GENRES.find((g) => g.name === name)?.en.toLowerCase() ?? name;
}

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

export function getSearchItems(): SearchItem[] {
  return ANIME.map(({ slug, title, titleEn, year, score, type, art, genres }) => ({
    slug,
    title,
    titleEn,
    year,
    score,
    type,
    art,
    genres,
  }));
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
