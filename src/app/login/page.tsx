import type { Metadata } from "next";
import { AuthView } from "@/components/auth-view";
import { ANIME } from "@/lib/data";
import { artworkFor } from "@/lib/images";

export const metadata: Metadata = {
  title: "ورود و ثبت‌نام",
  description:
    "به حساب کاربری انیمه‌ورس وارد شو تا علاقه‌مندی‌هایت ذخیره شوند و به لینک‌های دانلود ۱۰۸۰p دسترسی پیدا کنی.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { mode?: string };
}) {
  const initialMode = searchParams.mode === "register" ? "register" : "login";
  const art = ANIME.find((a) => a.slug === "frieren") ?? ANIME[0];
  const cover = art?.cover || artworkFor(art?.slug ?? "")?.cover;
  const blur = art?.cover ? undefined : artworkFor(art?.slug ?? "")?.blur;
  return <AuthView initialMode={initialMode} cover={cover} blur={blur} />;
}
