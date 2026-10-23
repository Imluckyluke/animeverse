import { SITE } from "@/lib/data";
import HalftoneWordmarkFooter, { type FooterColumn } from "@/components/ui/halftone-wordmark-footer";

const COLUMNS: FooterColumn[] = [
  {
    title: "بخش‌ها",
    links: [
      { label: "خانه", href: "/" },
      { label: "آرشیو", href: "/browse" },
      { label: "جستو‌جو", href: "/browse" },
    ],
  },
  {
    title: "کتابخانه",
    links: [
      { label: "علاقه‌مندی‌ها", href: "/favorites" },
      { label: "ورود", href: "/login" },
    ],
  },
  {
    title: "ارتباط",
    links: [
      { label: "تلگرام", href: SITE.telegram },
      { label: "کانال آرشیو", href: SITE.telegram },
    ],
  },
];

export function SiteFooter() {
  return (
    <div className="relative z-10 mt-8">
      <HalftoneWordmarkFooter
        wordmark=""
        accent="#ffd60a"
        label={SITE.name}
        meta={`© ۲۰۲۶ ${SITE.name} · ${SITE.tagline}`}
        columns={COLUMNS}
        palette={{ background: "#060609", ink: "#ffffff", warm: "#ff9f0a" }}
        monoFamily="var(--font-vazirmatn), Tahoma, Arial, sans-serif"
        height="0px"
        band="clamp(64px, 10vw, 110px)"
        glow={0}
        dotGap={5}
        dotScale={0.5}
        radius={100}
        crop={0.1}
        grain={0}
        fill={0.98}
        bandGap={20}
        backToTopLabel="بازگشت به بالا ↑"
      />
    </div>
  );
}
