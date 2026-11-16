import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "قوانین استفاده", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <article className="shell py-10">
    <h1 className="headline text-2xl">قوانین استفاده</h1>
    <div className="mt-6 max-w-3xl space-y-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-8 text-content-soft sm:p-8">
      <section><h2 className="font-bold text-white">کارکرد سایت</h2><p>مرور آرشیو و دریافت فایل به ورود نیاز ندارد. نمایش کتابخانه و تاریخچهٔ دانلودهای شخصی به ورود وابسته است. کتابخانهٔ حساب سراسری روی سرور و حساب قدیمی محلی روی همان دستگاه ذخیره می‌شود؛ خروج از حساب، داده‌ها یا درخواست‌های دانلود ثبت‌شده را حذف نمی‌کند.</p></section>
      <section><h2 className="font-bold text-white">اطلاعات و لینک‌ها</h2><p>اطلاعات آرشیو و وضعیت لینک‌ها ممکن است تغییر کند یا کامل نباشد. موجود بودن یک عنوان به معنی آماده بودن همهٔ قسمت‌ها و کیفیت‌های آن نیست. زمان قسمت بعد فقط در صورت وجود دادهٔ تأییدشده نمایش داده می‌شود.</p></section>
      <section><h2 className="font-bold text-white">حقوق محتوا و استفادهٔ مسئولانه</h2><p>حقوق آثار، تصاویر و نام‌های تجاری متعلق به صاحبان آن‌هاست. پیش از استفاده از محتوا، شرایط منبع و قوانین محل زندگی خود را رعایت کن. از تلاش برای دسترسی غیرمجاز به بخش مدیریت یا ایجاد اختلال در سرویس خودداری کن.</p></section>
      <section><h2 className="font-bold text-white">حساب و همگام‌سازی</h2><p>حساب سراسری از حالت مهمان و حساب‌های محلی قدیمی جداست. از رمز مناسب استفاده کن؛ تغییرات هنگام قطع ارتباط تا تأیید سرور ممکن است فقط روی دستگاه باقی بمانند. پاک‌کردن دادهٔ مرورگر به معنی حذف حساب سرور نیست. جزئیات در <Link href="/privacy" className="text-amber-300 underline">حریم خصوصی</Link> آمده است.</p></section>
    </div>
  </article>;
}
