import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "اتصال قطع است",
  description: "اینترنت وصل نیست؛ بهمحض برگشتن اتصال، آرشیو انیمهورس دوباره باز میشود.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div className="shell flex min-h-[70vh] items-center justify-center py-12">
      <div className="glass-card w-full max-w-md px-6 py-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-amber-400/35 bg-amber-400/12 text-amber-300">
          <WifiOff className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-black text-white">اتصال اینترنت قطع است</h1>
        <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-7 text-content-muted">
          صفحهای که قبلاً دیدهای همچنان در دسترس است. بهمحض برگشتن اینترنت، آرشیو دوباره
          کامل میشود.
        </p>
        <Link href="/" className="btn btn-primary btn-lg mt-6 w-full">
          تلاش دوباره
        </Link>
      </div>
    </div>
  );
}
