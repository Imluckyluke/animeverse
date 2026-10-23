import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "حریم خصوصی", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return <article className="shell py-10">
    <h1 className="headline text-2xl">حریم خصوصی</h1>
    <div className="mt-6 max-w-3xl space-y-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-8 text-content-soft sm:p-8">
      <section><h2 className="font-bold text-white">اطلاعات روی همین دستگاه</h2><p>حساب کاربری، علاقه‌مندی‌ها و علامت قسمت‌های مشاهده‌شده در فضای ذخیره‌سازی مرورگر همین دستگاه نگهداری می‌شوند. این حساب، حساب آنلاین با همگام‌سازی بین دستگاه‌ها نیست. رمز عبور به‌شکل هش و همراه با نمک ذخیره می‌شود، نه متن ساده.</p></section>
      <section><h2 className="font-bold text-white">پاک‌کردن اطلاعات</h2><p>پاک‌کردن داده‌های سایت از تنظیمات مرورگر، اطلاعات محلی را از بین می‌برد. خروج از حساب به‌تنهایی علاقه‌مندی‌ها و سابقهٔ قسمت‌ها را پاک نمی‌کند. در نسخهٔ فعلی بازیابی حساب از طریق ایمیل ارائه نمی‌شود.</p></section>
      <section><h2 className="font-bold text-white">ارتباط با سرویس‌های دیگر</h2><p>بازکردن سایت و دریافت تصویر یا لینک، درخواست شبکه ایجاد می‌کند. اطلاعات فنی معمول درخواست مانند نشانی IP می‌تواند در زیرساخت میزبانی پردازش شود. با بازکردن لینک‌های تلگرام یا دیگر سایت‌ها، سیاست همان سرویس‌ها اعمال می‌شود. اتصال اعلان تلگرام اختیاری است و به در دسترس بودن سرویس اعلان وابسته است.</p></section>
      <Link href="/login" className="inline-flex min-h-11 items-center font-bold text-amber-300">بازگشت به حساب کاربری</Link>
    </div>
  </article>;
}
