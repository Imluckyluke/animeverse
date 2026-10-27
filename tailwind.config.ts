import type { Config } from "tailwindcss";

const config: Config = {
  future: { hoverOnlyWhenSupported: true },
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-vazirmatn)", "Tahoma", "Arial", "sans-serif"],
      },
      colors: {
        white: "rgb(var(--av-white, 255 255 255) / <alpha-value>)",
        ink: {
          950: "rgb(var(--av-ink-950, 6 6 9) / <alpha-value>)",
          900: "rgb(var(--av-ink-900, 12 12 19) / <alpha-value>)",
          850: "rgb(var(--av-ink-850, 23 23 31) / <alpha-value>)",
          800: "rgb(var(--av-ink-800, 32 32 43) / <alpha-value>)",
          700: "rgb(var(--av-ink-700, 42 42 54) / <alpha-value>)",
          600: "rgb(var(--av-ink-600, 52 52 66) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgba(255,255,255,0.045)",
          strong: "rgba(255,255,255,0.085)",
        },
        line: {
          DEFAULT: "rgba(255,255,255,0.1)",
          strong: "rgba(255,255,255,0.18)",
        },
        content: {
          DEFAULT: "rgb(var(--av-content, 245 247 255) / <alpha-value>)",
          soft: "rgb(var(--av-content-soft, 211 217 232) / <alpha-value>)",
          muted: "rgb(var(--av-content-muted, 154 164 186) / <alpha-value>)",
          faint: "rgb(var(--av-content-faint, 121 131 154) / <alpha-value>)",
        },
        brand: {
          50: "#edf3ff",
          100: "#dbe6ff",
          200: "#bdd0ff",
          300: "#93b3ff",
          400: "#6d93ff",
          500: "#4d74ea",
          600: "#3a5cc4",
          700: "#2e489c",
          800: "#263a78",
          900: "#1d2b57",
        },
        amber: {
          200: "rgb(var(--av-amber-200, 255 243 176) / <alpha-value>)",
          300: "rgb(var(--av-amber-300, 255 224 102) / <alpha-value>)",
          400: "#ffd60a",
          500: "#e6be00",
          600: "#b39200",
        },
        aqua: {
          300: "#8ef0ff",
          400: "#5ee4ff",
          500: "#38d6ff",
          600: "#16b8e8",
        },
        rose: {
          400: "#ff8fbc",
          500: "#ff6ba6",
          600: "#ee4a8c",
        },
        gold: {
          300: "rgb(var(--av-gold-300, 255 224 138) / <alpha-value>)",
          400: "rgb(var(--av-gold-400, 255 208 92) / <alpha-value>)",
          500: "#f6ba36",
        },
        success: "#3ddc97",
        danger: "#ff7188",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1.1rem" }],
        xs: ["0.75rem", { lineHeight: "1.35rem" }],
        sm: ["0.8125rem", { lineHeight: "1.7rem" }],
        base: ["0.9375rem", { lineHeight: "1.95rem" }],
        lg: ["1.0625rem", { lineHeight: "2rem" }],
        xl: ["1.25rem", { lineHeight: "2.1rem" }],
        "2xl": ["1.5rem", { lineHeight: "2.4rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.8rem" }],
        "4xl": ["2.375rem", { lineHeight: "3.2rem" }],
        "5xl": ["3rem", { lineHeight: "3.7rem" }],
        "6xl": ["3.75rem", { lineHeight: "4.3rem" }],
        "7xl": ["4.5rem", { lineHeight: "5rem" }],
        display: ["clamp(2.35rem,6vw,4.5rem)", { lineHeight: "1.22", fontWeight: "900" }],
        "display-sm": ["clamp(1.9rem,4.5vw,3rem)", { lineHeight: "1.3", fontWeight: "900" }],
      },
      spacing: {
        4.5: "1.125rem",
        18: "4.5rem",
        22: "5.5rem",
        26: "6.5rem",
        30: "7.5rem",
      },
      borderRadius: {
        // Corner system: 12 controls · 16 nested/media · 24 cards · 28 sheets · full pills.
        "4xl": "1.75rem",
        "5xl": "2.25rem",
      },
      boxShadow: {
        soft: "0 12px 40px -18px rgba(0,0,0,.85)",
        lift: "0 30px 80px -30px rgba(0,0,0,.92)",
        glass:
          "0 24px 60px -30px rgba(0,0,0,.95), inset 0 1px 0 rgba(255,255,255,.09), inset 0 -1px 0 rgba(0,0,0,.35)",
        glow: "0 0 0 1px rgba(109,147,255,.25), 0 18px 60px -18px rgba(109,147,255,.45)",
        "glow-amber": "0 0 0 1px rgba(255,214,10,.3), 0 18px 55px -18px rgba(255,214,10,.4)",
        "glow-aqua": "0 0 0 1px rgba(56,214,255,.2), 0 18px 60px -18px rgba(56,214,255,.4)",
        inset: "inset 0 1px 0 rgba(255,255,255,.1)",
        poster: "0 30px 70px -35px rgba(0,0,0,.95), 0 0 0 1px rgba(255,255,255,.1)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg,#6d93ff 0%,#3a5cc4 100%)",
        "accent-gradient": "linear-gradient(90deg,#4d74ea 0%,#ffd60a 100%)",
        "brand-soft": "linear-gradient(135deg,rgba(109,147,255,.18),rgba(255,214,10,.08))",
        "glass-sheen":
          "linear-gradient(160deg,rgba(255,255,255,.1),rgba(255,255,255,.025) 42%,rgba(255,255,255,0) 72%)",
        "fade-bottom": "linear-gradient(to top,rgba(6,6,9,1) 0%,rgba(6,6,9,.72) 45%,rgba(6,6,9,0) 100%)",
      },
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(-100%)" },
        },
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        aurora: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)", opacity: ".55" },
          "50%": { transform: "translate3d(-4%,4%,0) scale(1.12)", opacity: ".8" },
        },
        pulseRing: {
          "0%": { transform: "scale(.9)", opacity: ".7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(50%)" },
        },
        sheen: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" },
        },
        menuIn: {
          "0%": { opacity: "0", transform: "translateY(-8px) scale(.96)", filter: "blur(6px)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)", filter: "blur(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.8s infinite",
        floaty: "floaty 7s ease-in-out infinite",
        aurora: "aurora 18s ease-in-out infinite",
        "pulse-ring": "pulseRing 2.6s ease-out infinite",
        marquee: "marquee 32s linear infinite",
        sheen: "sheen 2.8s ease-in-out infinite",
        "menu-in": "menuIn .24s cubic-bezier(.16,1,.3,1) both",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(.22,.61,.36,1)",
        snap: "cubic-bezier(.16,1,.3,1)",
      },
      screens: {
        xs: "420px",
        "3xl": "1600px",
      },
      zIndex: {
        60: "60",
        70: "70",
      },
    },
  },
  plugins: [],
};

export default config;
