"use client";

import { motion, useScroll, useSpring } from "framer-motion";

/** The thin amber rule at the top of the gallery, filled by the page itself. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 26,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[70] h-[2.5px] origin-right bg-gradient-to-l from-amber-300 via-amber-400 to-amber-500 shadow-[0_0_14px_rgba(255,183,0,.6)]"
    />
  );
}
