import type { Metadata } from "next";
import { AuthView } from "@/components/auth-view";

export const metadata: Metadata = {
  title: "ورود و ثبت‌نام",
  description:
    "به حساب کاربری انیمه‌ورس وارد شو تا علاقه‌مندی‌هایت ذخیره شوند و به لینک‌های دانلود ۱۰۸۰p دسترسی پیدا کنی.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { mode?: string };
}) {
  const initialMode = searchParams.mode === "register" ? "register" : "login";
  return <AuthView initialMode={initialMode} />;
}
