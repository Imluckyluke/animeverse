import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { SiteFooter } from "@/components/site-footer";
import { MobileNav } from "@/components/mobile-nav";
import { Providers } from "@/components/providers";
import { SITE } from "@/lib/data";
import "./globals.css";
import "./light-theme.css";
import "./downloads.css";

const vazirmatn = localFont({
  src: "./fonts/Vazirmatn.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-vazirmatn",
  fallback: ["Tahoma", "Arial", "sans-serif"],
});

const publicSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.AV_PUBLIC_URL || "")
  .trim()
  .replace(/\/+$/, "");
// Always set a base so relative OG/canonical URLs resolve (the public URL on
// Vercel, localhost during development) instead of silently dropping out.
const siteBase = publicSiteUrl || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteBase),
  title: {
    default: "انیمه‌ورس | دانلود انیمه با زیرنویس فارسی",
    template: "%s | انیمه‌ورس",
  },
  description: SITE.description,
  applicationName: SITE.name,
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    title: "انیمه‌ورس",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  keywords: [
    "دانلود انیمه",
    "انیمه",
    "زیرنویس فارسی",
    "دوبله",
    "انیمه‌ورس",
    "AnimeVerse",
    "دانلود انیمه ۱۰۸۰p",
  ],
  authors: [{ name: SITE.name }],
  openGraph: {
    type: "website",
    locale: "fa_IR",
    siteName: SITE.name,
    title: "انیمه‌ورس | جهانی برای دیدن و دانلود انیمه",
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: "انیمه‌ورس | دانلود انیمه با زیرنویس فارسی",
    description: SITE.description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#eee9df",
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" data-theme="light" className={vazirmatn.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('av_theme')==='dark'?'dark':'light'}catch(e){}` }} />
      </head>
      <body className="relative min-h-screen overflow-x-hidden">
        <a
          href="#main"
          className="fixed right-4 top-4 z-[200] inline-flex min-h-11 -translate-y-24 items-center rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-[#1a1206] transition-transform focus:translate-y-0"
        >
          پرش به محتوا
        </a>
        <Providers>
          <Header />
          <main id="main" className="relative z-10 min-h-[60vh] pt-[var(--header-h)]">
            {children}
          </main>
          <SiteFooter />
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
