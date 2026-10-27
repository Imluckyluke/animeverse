"use client"

// Halftone Wordmark Footer — a site footer whose wordmark is set enormous and
// cropped by the bottom edge, printed as a field of halftone dots. Each dot is
// sized by how much of the letter covers its cell, so the type keeps its edges
// at any scale. Move across it and the dots part around the pointer on springs,
// warming in colour as they are pushed off their place; click and a shock ring
// runs through the word. Above it sit the studio line, tracked link columns and
// a back-to-top, separated by a hairline, all over a fine print grain.
//
// One file, React only. A 2D canvas for the dots and the grain, real anchors
// for the links. Every rule in the scoped <style> is .hwf- prefixed and nothing
// is fetched: the faces come from the host page or the fallback stacks.

import * as React from "react"

export interface HalftonePalette {
  /** The footer background. */
  background: string
  /** The dots at rest, and the text. */
  ink: string
  /** The colour a dot warms toward as it is pushed off its place. */
  warm: string
}

export type HalftonePreset = "night" | "paper" | "ember" | "cobalt"

export interface FooterLink {
  label: string
  href?: string
}

export interface FooterColumn {
  title: string
  links: FooterLink[]
}

export interface HalftoneWordmarkFooterProps {
  /** The giant word printed in dots. Lowercase reads best. */
  wordmark?: string
  /** A second colour for the tail of the wordmark, e.g. "verse" in "animeverse". */
  accent?: string
  /** Character index where the accent colour begins. 0 / omitted disables it. */
  accentFrom?: number
  /** Width of the white→accent fade, as a fraction of the word width. Defaults to 0.25. */
  accentFeather?: number
  /** Top-left studio line. */
  label?: string
  /** The muted line under it. */
  meta?: string
  /** Link columns along the top. */
  columns?: FooterColumn[]
  /** Show the back-to-top link. It scrolls the window to 0. Defaults to true. */
  backToTop?: boolean
  /** Label for the back-to-top control. Defaults to "Back to top ↑". */
  backToTopLabel?: string
  /** Starting colours. Defaults to "night". */
  preset?: HalftonePreset
  /** Colour overrides, merged over the preset. */
  palette?: { background?: string; ink?: string; warm?: string }
  /** Distance between dot centres, in CSS px. Defaults to 4. */
  dotGap?: number
  /** Size multiplier relative to the grid. Lower = smaller, airier dots. Defaults to 0.58. */
  dotScale?: number
  /** Strength of the soft amber bloom behind the accent side, 0 disables. Defaults to 0.4. */
  glow?: number
  /** How far the pointer pushes, in CSS px. Defaults to 90. */
  radius?: number
  /** How much of the word's cap height hangs below the bottom edge, 0–0.6. Defaults to 0.1. */
  crop?: number
  /** Print grain over everything, 0–1. Defaults to 0.4. */
  grain?: number
  /** How much of the width the word fills, 0–1.4. Defaults to 1. */
  fill?: number
  /** Clearance kept between the link block and the wordmark, in px. Defaults to 18. */
  bandGap?: number
  /** Pointer and click response. Defaults to true. */
  interactive?: boolean
  /** Face for the wordmark. Heavy grotesks print best. */
  fontFamily?: string
  /** Weight of the wordmark. Defaults to 800. */
  fontWeight?: number
  /** Face for the small type. */
  monoFamily?: string
  /** Minimum root height. A definite length, never a percentage. */
  height?: string
  /** Height reserved below the links for the wordmark. Defaults to a responsive step. */
  band?: string
  /** Extra root class names. */
  className?: string
}

const PRESETS: { [K in HalftonePreset]: HalftonePalette } = {
  night: { background: "#0c0c0b", ink: "#e9e4da", warm: "#e9762b" },
  paper: { background: "#efebe3", ink: "#17150f", warm: "#c2361c" },
  ember: { background: "#160a06", ink: "#f2c48c", warm: "#ff5a1f" },
  cobalt: { background: "#0d1b4d", ink: "#dfe7ff", warm: "#ffcd3c" },
}

const DEFAULT_COLUMNS: FooterColumn[] = [
  { title: "Work", links: [{ label: "Index" }, { label: "Archive" }, { label: "Journal" }] },
  { title: "Studio", links: [{ label: "About" }, { label: "Process" }, { label: "Careers" }] },
  { title: "Contact", links: [{ label: "hello@halden.co" }, { label: "+47 22 00 41 00" }] },
]

const SANS_STACK = '"Inter Tight", "Inter Variable", "Inter", "Helvetica Neue", Arial, system-ui, sans-serif'
const MONO_STACK = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace'

// #region halftone
// Pure helpers, lifted out and executed by tests/halftone-wordmark-footer.test.mjs.

/** Hex → [r, g, b] in 0–255, or null for anything that isn't #rgb / #rrggbb. */
export function hwfHex(hex: string) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Dot radius for a cell coverage in [0, 1]: area-true, so tone stays even. */
export function hwfRadius(coverage: number, gap: number, scale = 0.58) {
  const c = coverage < 0 ? 0 : coverage > 1 ? 1 : coverage
  return Math.sqrt(c) * gap * (scale > 0 ? scale : 0.58)
}

/**
 * One step of a dot's spring back to home, plus the push from a pointer at
 * (px, py) within radius r. Returns [x, y, vx, vy]. Away from the pointer a
 * displaced dot always heads home and comes to rest.
 */
export function hwfStep(
  x: number, y: number, vx: number, vy: number,
  hx: number, hy: number, px: number, py: number, r: number,
) {
  const dx = x - px
  const dy = y - py
  const d2 = dx * dx + dy * dy
  if (r > 0 && d2 < r * r) {
    const d = Math.sqrt(d2) + 0.001
    const f = (1 - d / r) * 2.6
    vx += (dx / d) * f
    vy += (dy / d) * f
  }
  vx = (vx + (hx - x) * 0.05) * 0.84
  vy = (vy + (hy - y) * 0.05) * 0.84
  return [x + vx, y + vy, vx, vy]
}

/** How warm a dot is drawn: 0 at home, 1 once it is `span` px or more away. */
export function hwfWarmth(x: number, y: number, hx: number, hy: number, span: number) {
  const d = Math.hypot(x - hx, y - hy)
  return span > 0 ? Math.min(1, d / span) : 0
}

/** Font size that sets `measured` (width at 100px) to fill `width` exactly. */
export function hwfFitSize(measured: number, width: number) {
  return measured > 0 ? (width / measured) * 100 : 0
}
// #endregion

const HWF_CSS = `
.hwf-root {
  position: relative; width: 100%; overflow: hidden; isolation: isolate;
  background: var(--hwf-bg); color: var(--hwf-ink); -webkit-font-smoothing: antialiased;
}
.hwf-root canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; max-width: none; }
.hwf-band { position: relative; display: block; width: 100%; pointer-events: none; }
.hwf-top {
  position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1.25fr) repeat(3, minmax(0, 1fr));
  gap: clamp(18px, 2.6vw, 32px); padding: clamp(24px, 3.6vw, 42px) clamp(20px, 3.4vw, 44px) 0;
  font-family: var(--hwf-mono); font-size: clamp(12.5px, 2.9vw, 13px); letter-spacing: .06em;
  text-transform: uppercase; line-height: 1.8;
}
.hwf-brand strong { display: block; font-weight: 700; letter-spacing: .04em; }
.hwf-brand span { display: block; margin-top: 3px; opacity: .5; }
.hwf-col h3 { display: flex; align-items: center; margin: 0 0 6px; font: inherit; opacity: .55; font-weight: 700; letter-spacing: .1em; }
.hwf-col h3::before {
  content: ""; flex: none; width: 5px; height: 5px; margin-inline-end: 8px; border-radius: 1.5px;
  background: var(--hwf-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--hwf-accent) 55%, transparent);
}
.hwf-col ul { list-style: none; margin: 0; padding: 0; }
.hwf-col li + li { margin-top: 3px; }
.hwf-col a, .hwf-up {
  color: inherit; text-decoration: none; opacity: .82; background: none; border: 0; padding: 3px 0;
   display: inline-flex; align-items: center; min-height: 44px; font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer;
  background-image: linear-gradient(currentColor, currentColor); background-size: 0% 1px;
  background-repeat: no-repeat; background-position: 0 100%; transition: opacity .25s ease, background-size .35s cubic-bezier(.2,.7,.1,1);
}
.hwf-col a:hover, .hwf-up:hover { opacity: 1; background-size: 100% 1px; }
.hwf-col a:focus-visible, .hwf-up:focus-visible { outline: 1px solid var(--hwf-accent); outline-offset: 3px; opacity: 1; }
.hwf-rule .hwf-up {
  padding: 8px 15px; border: 1px solid color-mix(in srgb, var(--hwf-ink) 20%, transparent); border-radius: 999px;
}
.hwf-rule .hwf-up:hover {
  background-size: 0 1px; border-color: color-mix(in srgb, var(--hwf-accent) 60%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hwf-accent) 12%, transparent);
}
.hwf-rule {
  position: relative; z-index: 1; display: flex; justify-content: flex-end; align-items: center; gap: 16px;
  margin: clamp(14px, 2.2vw, 24px) clamp(20px, 3.4vw, 44px) 0; padding-top: 12px;
  border-top: 0.5px solid color-mix(in srgb, var(--hwf-ink) 16%, transparent);
  font-family: var(--hwf-mono); font-size: clamp(12px, 2.8vw, 12.5px); letter-spacing: .08em; text-transform: uppercase;
}
.hwf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 720px) {
  .hwf-top { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); row-gap: 24px; }
  .hwf-brand { grid-column: 1 / -1; }
  .hwf-col h3 { margin-bottom: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .hwf-col a, .hwf-up { transition: none; }
}
`

export default function HalftoneWordmarkFooter({
  wordmark = "halden",
  accent,
  accentFrom = 0,
  accentFeather = 0.25,
  label = "Halden Studio",
  meta = "©2026 · Oslo / Lisbon",
  columns = DEFAULT_COLUMNS,
  backToTop = true,
  backToTopLabel = "Back to top ↑",
  preset = "night",
  palette,
  dotGap = 4,
  dotScale = 0.58,
  glow = 0.4,
  radius = 90,
  crop = 0.1,
  grain = 0.4,
  fill = 1,
  bandGap = 18,
  interactive = true,
  fontFamily = SANS_STACK,
  fontWeight = 800,
  monoFamily = MONO_STACK,
  height = "560px",
  band = "clamp(150px, 24vw, 300px)",
  className = "",
}: HalftoneWordmarkFooterProps) {
  const colors = { ...(PRESETS[preset] || PRESETS.night), ...(palette || {}) }
  const rootRef = React.useRef(null as HTMLElement | null)
  const canvasRef = React.useRef(null as HTMLCanvasElement | null)
  const opts = React.useRef({
    colors, dotGap, dotScale, glow, radius, crop, grain, interactive, fontFamily, fontWeight, wordmark,
    accent, accentFrom, accentFeather, fill, bandGap,
  })
  opts.current = {
    colors, dotGap, dotScale, glow, radius, crop, grain, interactive, fontFamily, fontWeight, wordmark,
    accent, accentFrom, accentFeather, fill, bandGap,
  }
  const key = [
    wordmark, accent, accentFrom, accentFeather, dotGap, dotScale, glow, crop, grain, fill, bandGap,
    fontFamily, fontWeight, colors.background, colors.ink, colors.warm,
  ].join("|")

  React.useEffect(() => {
    if (!opts.current.wordmark.trim()) return
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    // Supersample the type mask so dot coverage keeps soft, even edges.
    const SS = 2
    let w = 0
    let h = 0
    let dpr = 1
    let px = -1e5
    let py = -1e5
    let raf = 0
    let visible = true
    let awake = true
    let ring = { x: 0, y: 0, t: -1 }
    // Flat arrays: x, y, vx, vy, hx, hy, r, accentRatio per dot.
    let dots = new Float32Array(0)
    let count = 0
    let grainTile = null as HTMLCanvasElement | null
    let glowLayer = null as HTMLCanvasElement | null
    const ink = hwfHex(opts.current.colors.ink) || [233, 228, 218]
    const warm = hwfHex(opts.current.colors.warm) || [233, 118, 43]
    const accentRGB = hwfHex(opts.current.accent || "") || ink
    // A small radial sprite, stamped under the amber side for a warm bloom.
    const glowSprite = (() => {
      const size = 64
      const c = document.createElement("canvas")
      c.width = size
      c.height = size
      const g = c.getContext("2d")
      if (g) {
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
        grad.addColorStop(0, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + ",0.7)")
        grad.addColorStop(0.28, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + ",0.22)")
        grad.addColorStop(0.6, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + ",0.05)")
        grad.addColorStop(1, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + ",0)")
        g.fillStyle = grad
        g.fillRect(0, 0, size, size)
      }
      return c
    })()

    const layout = () => {
      const o = opts.current
      const rect = root.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      // Render well above the CSS size so browser zoom keeps the dots crisp.
      const baseDpr = window.devicePixelRatio || 1
      dpr = Math.min(baseDpr * 2, 4, Math.sqrt(8000000 / Math.max(1, w * h)))
      if (dpr < 1.5) dpr = 1.5
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)

      // Never let the word ride up into the links / back-to-top block.
      const rule = root.querySelector(".hwf-rule") as HTMLElement | null
      const ruleRect = rule ? rule.getBoundingClientRect() : null
      const bandTop = ruleRect ? Math.max(0, ruleRect.bottom - rect.top + (o.bandGap || 0)) : 0
      const avail = Math.max(h * 0.28, h - bandTop)

      const sw = w * SS
      const sh = h * SS
      const makeMask = () => {
        const el = document.createElement("canvas")
        el.width = sw
        el.height = sh
        return el
      }

      const mask = makeMask()
      const m = mask.getContext("2d", { willReadFrequently: true })
      if (!m) return

      const word = o.wordmark || " "
      const c = Math.max(0, Math.min(0.6, o.crop))
      m.font = o.fontWeight + " " + 100 * SS + "px " + o.fontFamily
      const measured = m.measureText(word).width
      let fit = measured > 0 ? ((w * (o.fill || 1) * SS) / measured) * 100 * SS : 0
      m.font = o.fontWeight + " " + fit + "px " + o.fontFamily
      let box = m.measureText(word)
      let cap = box.actualBoundingBoxAscent || fit * 0.72
      const maxCap = (avail * SS) / Math.max(0.1, 1 - c)
      if (cap > maxCap && cap > 0) {
        fit *= maxCap / cap
        m.font = o.fontWeight + " " + fit + "px " + o.fontFamily
        box = m.measureText(word)
        cap = box.actualBoundingBoxAscent || fit * 0.72
      }
      const y = sh + cap * c
      const x0 = (sw - box.width) / 2
      m.fillStyle = "#000"
      m.textBaseline = "alphabetic"
      m.fillText(word, x0, y)
      const img = m.getImageData(0, 0, sw, sh).data

      // The accent colour eases in across the word, so white and yellow fade
      // into one another instead of meeting at a hard edge.
      let accentX = Infinity
      let accentF = 0
      if (o.accent && o.accentFrom > 0 && o.accentFrom < word.length) {
        accentX = (x0 + m.measureText(word.slice(0, o.accentFrom)).width) / SS
        accentF = Math.max(1, (o.accentFeather > 0 ? o.accentFeather : 0.25) * (box.width / SS))
      }

      const gap = Math.max(3, o.dotGap)
      const cols = Math.ceil(w / gap)
      const rows = Math.ceil(h / gap)
      const tmp: number[] = []
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          // Coverage: average alpha over a 3×3 sample of the cell.
          let sum = 0
          for (let sy = 0; sy < 3; sy++) {
            for (let sx = 0; sx < 3; sx++) {
              const ix = Math.min(sw - 1, Math.floor((gx + (sx + 0.5) / 3) * gap * SS))
              const iy = Math.min(sh - 1, Math.floor((gy + (sy + 0.5) / 3) * gap * SS))
              sum += img[(iy * sw + ix) * 4 + 3]
            }
          }
          const cov = sum / (9 * 255)
          if (cov < 0.03) continue
          const hx = gx * gap + gap / 2
          const hy = gy * gap + gap / 2
          // Smoothstep across the fade band → per-dot accent weight.
          let ratio = 0
          if (accentF > 0) {
            const t = Math.min(1, Math.max(0, (hx - (accentX - accentF)) / (2 * accentF)))
            ratio = t * t * (3 - 2 * t)
          }
          tmp.push(hx, hy, 0, 0, hx, hy, hwfRadius(cov, gap, o.dotScale), ratio)
        }
      }
      dots = new Float32Array(tmp)
      count = tmp.length / 8

      // A static warm bloom under the accent side. Pre-rendered once per layout
      // so the live dots stay crisp and the frame loop stays cheap.
      glowLayer = null
      const gs = o.glow
      if (gs > 0 && count > 0) {
        // Half resolution, then upscaled on composite: a free, wide blur.
        const gscale = 0.5
        const layer = document.createElement("canvas")
        layer.width = Math.max(1, Math.round(w * gscale))
        layer.height = Math.max(1, Math.round(h * gscale))
        const gc = layer.getContext("2d")
        if (gc) {
          gc.globalCompositeOperation = "lighter"
          for (let i = 0; i < count; i++) {
            const j = i * 8
            const dr = dots[j + 6]
            if (dr < 1) continue
            const gr = dr * 6
            // Even bloom under the whole word, only its size follows the dot.
            gc.globalAlpha = Math.min(0.22, gs * 0.6)
            gc.drawImage(
              glowSprite,
              (dots[j + 4] - gr) * gscale,
              (dots[j + 5] - gr) * gscale,
              gr * 2 * gscale,
              gr * 2 * gscale,
            )
          }
          gc.globalAlpha = 1
          gc.globalCompositeOperation = "source-over"
          glowLayer = layer
        }
      }

      // A fixed tile of print grain, drawn once and laid over every frame.
      grainTile = document.createElement("canvas")
      grainTile.width = 256
      grainTile.height = 256
      const g = grainTile.getContext("2d")
      if (g) {
        const id = g.createImageData(256, 256)
        for (let i = 0; i < id.data.length; i += 4) {
          const v = Math.random() * 255
          id.data[i] = id.data[i + 1] = id.data[i + 2] = v
          id.data[i + 3] = Math.random() < 0.5 ? 0 : 255
        }
        g.putImageData(id, 0, 0)
      }
      awake = true
    }

    const draw = (now: number) => {
      const o = opts.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = o.colors.background
      ctx.fillRect(0, 0, w, h)
      if (glowLayer) ctx.drawImage(glowLayer, 0, 0, w, h)

      const r = o.interactive && !reduced ? Math.max(0, o.radius) : 0
      const ringAge = ring.t < 0 ? 1e9 : now - ring.t
      const ringR = ringAge * 0.9
      let moving = false
      for (let i = 0; i < count; i++) {
        const j = i * 8
        let x = dots[j]
        let y = dots[j + 1]
        let vx = dots[j + 2]
        let vy = dots[j + 3]
        const hx = dots[j + 4]
        const hy = dots[j + 5]
        if (!reduced) {
          if (ringAge < 900) {
            const dx = hx - ring.x
            const dy = hy - ring.y
            const d = Math.sqrt(dx * dx + dy * dy) + 0.001
            const band = 1 - Math.min(1, Math.abs(d - ringR) / 26)
            if (band > 0) {
              const f = band * 3.2 * (1 - ringAge / 900)
              vx += (dx / d) * f
              vy += (dy / d) * f
            }
          }
          const s = hwfStep(x, y, vx, vy, hx, hy, px, py, r)
          x = s[0]
          y = s[1]
          vx = s[2]
          vy = s[3]
          if (Math.abs(vx) + Math.abs(vy) > 0.02 || Math.abs(x - hx) + Math.abs(y - hy) > 0.05) moving = true
          else {
            x = hx
            y = hy
            vx = 0
            vy = 0
          }
          dots[j] = x
          dots[j + 1] = y
          dots[j + 2] = vx
          dots[j + 3] = vy
        }
        // Base colour: white ink, warming to the accent tail where it applies.
        const ratio = o.accent ? dots[j + 7] : 0
        let br = ink[0]
        let bg = ink[1]
        let bb = ink[2]
        if (ratio > 0.001) {
          br += (accentRGB[0] - br) * ratio
          bg += (accentRGB[1] - bg) * ratio
          bb += (accentRGB[2] - bb) * ratio
        }
        const k = hwfWarmth(x, y, hx, hy, 28)
        if (k > 0.02) {
          br += (warm[0] - br) * k
          bg += (warm[1] - bg) * k
          bb += (warm[2] - bb) * k
        }
        ctx.fillStyle = "rgb(" + Math.round(br) + "," + Math.round(bg) + "," + Math.round(bb) + ")"
        ctx.beginPath()
        ctx.arc(x, y, dots[j + 6], 0, 6.2832)
        ctx.fill()
      }

      if (grainTile && o.grain > 0) {
        ctx.globalAlpha = Math.min(1, o.grain) * 0.08
        ctx.globalCompositeOperation = "overlay"
        const pattern = ctx.createPattern(grainTile, "repeat")
        if (pattern) {
          ctx.fillStyle = pattern
          ctx.fillRect(0, 0, w, h)
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = "source-over"
      }
      // Sleep once everything is home and nothing is pushing.
      awake = moving || ringAge < 900 || px > -1e4
    }

    const loop = (now: number) => {
      raf = 0
      if (!visible) return
      draw(now)
      if (awake) raf = requestAnimationFrame(loop)
    }
    const wake = () => {
      awake = true
      if (!raf && visible) raf = requestAnimationFrame(loop)
    }

    const toLocal = (e: PointerEv) => {
      const b = canvas.getBoundingClientRect()
      return [e.clientX - b.left, e.clientY - b.top]
    }
    const onMove = (e: PointerEv) => {
      if (!opts.current.interactive) return
      const p = toLocal(e)
      px = p[0]
      py = p[1]
      wake()
    }
    const onLeave = () => {
      px = -1e5
      py = -1e5
      wake()
    }
    const onDown = (e: PointerEv) => {
      if (!opts.current.interactive || reduced) return
      if ((e.target as HTMLElement).closest("a,button")) return
      const p = toLocal(e)
      ring = { x: p[0], y: p[1], t: performance.now() }
      wake()
    }

    layout()
    draw(performance.now())
    wake()

    root.addEventListener("pointermove", onMove)
    root.addEventListener("pointerleave", onLeave)
    root.addEventListener("pointerdown", onDown)
    const ro = new ResizeObserver(() => {
      layout()
      wake()
    })
    ro.observe(root)
    const io = new IntersectionObserver((entries) => {
      visible = entries[0] ? entries[0].isIntersecting : true
      if (visible) wake()
    })
    io.observe(root)
    // A web font that lands late re-sets the word in its real face.
    let alive = true
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (!alive) return
        layout()
        wake()
      })
    }

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      root.removeEventListener("pointermove", onMove)
      root.removeEventListener("pointerleave", onLeave)
      root.removeEventListener("pointerdown", onDown)
    }
  }, [key])

  const toTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <footer
      ref={rootRef}
      className={"hwf-root " + className}
      style={
        {
          minHeight: height,
          "--hwf-bg": colors.background,
          "--hwf-ink": colors.ink,
          "--hwf-mono": monoFamily,
          "--hwf-accent": accent || colors.warm,
        } as React.CSSProperties
      }
    >
      {/* Static, trusted CSS must remain raw text in SSR's style element. */}
      <style dangerouslySetInnerHTML={{ __html: HWF_CSS }} />
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="hwf-sr">{wordmark}</span>
      <div className="hwf-top">
        <div className="hwf-brand">
          <strong>{label}</strong>
          <span>{meta}</span>
        </div>
        {columns.map((col) => (
          <nav className="hwf-col" key={col.title} aria-label={col.title}>
            <h3>{col.title}</h3>
            <ul>
              {col.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href || "#"}>{l.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="hwf-rule">
        {backToTop ? (
          <button type="button" className="hwf-up" onClick={toTop}>
            {backToTopLabel}
          </button>
        ) : null}
      </div>
      <div className="hwf-band" style={{ height: band }} aria-hidden="true" />
    </footer>
  )
}

type PointerEv = PointerEvent
