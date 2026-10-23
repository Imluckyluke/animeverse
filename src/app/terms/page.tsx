import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "قوانین استفاده", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <article className="shell py-10">
    <h1 className="headline text-2xl">قوانین استفاده</h1>
    <div className="mt-6 max-w-3xl space-y-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-8 text-content-soft sm:p-8">
      <section><h2 className="font-bold text-white">کارکرد سایت</h2><p>انیمه‌ورس برای مرور اطلاعات انیمه‌ها، نگهداری فهرست شخصی روی دستگاه و دسترسی به لینک‌های موجود در آرشیو طراحی شده است. ذخیرهٔ علاقه‌مندی و استفاده از آرشیو به ساخت حساب نیاز ندارد.</p></section>
      <section><h2 className="font-bold text-white">اطلاعات و لینک‌ها</h2><p>اطلاعات آرشیو و وضعیت لینک‌ها ممکن است تغییر کند یا کامل نباشد. موجود بودن یک عنوان به معنی آماده بودن همهٔ قسمت‌ها و کیفیت‌های آن نیست. زمان قسمت بعد فقط در صورت وجود دادهٔ تأییدشده نمایش داده می‌شود.</p></section>
      <section><h2 className="font-bold text-white">حقوق محتوا و استفادهٔ مسئولانه</h2><p>حقوق آثار، تصاویر و نام‌های تجاری متعلق به صاحبان آن‌هاست. پیش از استفاده از محتوا، شرایط منبع و قوانین محل زندگی خود را رعایت کن. از تلاش برای دسترسی غیرمجاز به بخش مدیریت یا ایجاد اختلال در سرویس خودداری کن.</p></section>
      <section><h2 className="font-bold text-white">حساب محلی</h2><p>حساب روی همین مرورگر ذخیره می‌شود و جایگزین حساب آنلاین یا نسخهٔ پشتیبان نیست. جزئیات در <Link href="/privacy" className="text-amber-300 underline">حریم خصوصی</Link> آمده است.</p></section>
    </div>
  </article>;
}
