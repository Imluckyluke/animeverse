"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useState } from "react";
import { useApp, type ToastItem } from "@/lib/app-context";

/** The drop: a small circle under the header that then opens out to the card. */
const GONE = "circle(0px at 50% 23px)";
const DROP = "circle(23px at 50% 23px)";
const OPEN = "circle(420px at 50% 26px)";

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  // Which way it leaves: the way it was flicked, right by default.
  const [fly, setFly] = useState(1);
  const Icon =
    toast.tone === "error" ? AlertTriangle : toast.tone === "info" ? Info : CheckCircle2;

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.42}
      onDragEnd={(_, info) => {
        const dir = info.offset.x < 0 ? -1 : 1;
        setFly(dir);
        // Flick it either way and it leaves in that direction.
        if (Math.abs(info.offset.x) > 84 || Math.abs(info.velocity.x) > 520) {
          onDismiss(toast.id);
        }
      }}
      // The circle falls in, then the card opens out of it. Only the clip and
      // the offset move, so the frosted background never flickers the way an
      // opacity or scale wipe on glass does.
      initial={{ y: -72, clipPath: GONE }}
      animate={{
        y: [-72, 0, 0],
        clipPath: [GONE, DROP, OPEN],
      }}
      // It leaves sideways, off screen: no fade, so the glass can't blink.
      exit={{
        x: fly * (typeof window === "undefined" ? 600 : window.innerWidth),
        transition: { duration: 0.36, ease: [0.4, 0, 1, 1] },
      }}
      transition={{ duration: 1.25, times: [0, 0.38, 1], ease: [0.4, 0, 0.2, 1] }}
      style={{ willChange: "transform, clip-path" }}
      // Absolutely stacked, so an incoming drop never sits under the outgoing
      // card and then jump up when it leaves.
      className="pointer-events-auto absolute inset-x-0 top-0 cursor-grab touch-pan-y rounded-2xl border border-white/[0.12] bg-[rgba(18,18,26,.62)] shadow-lift backdrop-blur-[14px] backdrop-saturate-150 active:cursor-grabbing"
      role="status"
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.66, duration: 0.3, ease: "easeOut" }}
        className="flex items-start gap-3 p-3.5"
      >
        <span
          className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${
            toast.tone === "error"
              ? "bg-danger/15 text-danger"
              : toast.tone === "info"
                ? "bg-aqua-500/15 text-aqua-400"
                : "bg-success/15 text-success"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-6 text-white">{toast.title}</p>
          {toast.description ? (
            <p className="mt-0.5 text-2xs leading-5 text-content-muted">{toast.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="بستن اعلان"
          onClick={() => onDismiss(toast.id)}
          className="grid size-6 shrink-0 place-items-center rounded-full text-content-faint transition-colors hover:bg-white/5 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </motion.div>
    </motion.div>
  );
}

export function ToastViewport() {
  const { toasts, dismissToast } = useApp();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[95] px-4"
      style={{ top: "calc(var(--header-h) + 12px)" }}
    >
      {/* A zero-height, centred track: the toasts overlay each other instead of
          stacking, so a new one always drops in at the very top. */}
      <div className="relative mx-auto h-0 w-full max-w-sm">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}