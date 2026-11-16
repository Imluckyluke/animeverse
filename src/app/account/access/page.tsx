"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";

export default function AccountAccessPage() {
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) { setError("لینک ورود معتبر نیست یا منقضی شده است."); return; }
    void fetch("/api/account/access", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(20000) })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || result.user?.role !== "owner") throw new Error("لینک ورود معتبر نیست یا منقضی شده است.");
        window.location.replace("/admin");
      }).catch(() => setError("ورود انجام نشد؛ لینک ممکن است منقضی یا قبلاً استفاده شده باشد."));
  }, []);
  return <section className="shell py-16"><div className="glass-card mx-auto max-w-sm p-7 text-center">
    <ShieldCheck className="mx-auto size-8 text-amber-300" /><h1 className="headline mt-4 text-xl">ورود به حساب</h1>
    {error ? <><p role="alert" className="mt-4 text-sm leading-7 text-content-muted">{error}</p><Link href="/login" className="btn btn-glass btn-md mt-5">بازگشت</Link></> : <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />در حال ورود…</p>}
  </div></section>;
}
