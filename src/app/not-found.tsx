import Link from "next/link";
import { Compass, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="shell flex min-h-[70vh] flex-col items-center justify-center py-20 text-center">
      <p className="text-[clamp(90px,20vw,170px)] font-black leading-none tracking-tighter text-amber-300/90">
        ۴۰۴
      </p>
      <h1 className="headline mt-2 text-2xl sm:text-3xl">این صفحه در کهکشان نیست</h1>
      <p className="mt-3 max-w-sm text-sm leading-7 text-content-muted">
        شاید حذف شده باشد یا آدرس اشتباه تایپ شده. از آرشیو شروع کن؛ چیزهای خوب زیادی منتظرند.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
        <Link href="/" className="btn btn-primary btn-md">
          <Home className="size-4" />
          بازگشت به خانه
        </Link>
        <Link href="/browse" className="btn btn-glass btn-md">
          <Compass className="size-4" />
          آرشیو انیمه‌ها
        </Link>
      </div>
    </div>
  );
}
