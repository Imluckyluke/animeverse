import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "انیمه‌ورس | دانلود انیمه",
    short_name: "انیمه‌ورس",
    description: "دانلود انیمه با زیرنویس فارسی و کیفیت بالا",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#060609",
    theme_color: "#060609",
    dir: "rtl",
    lang: "fa",
    categories: ["entertainment", "video"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "آرشیو انیمه", short_name: "آرشیو", url: "/browse" },
      { name: "علاقه‌مندی‌ها", short_name: "علاقه‌مندی", url: "/favorites" },
    ],
  };
}
