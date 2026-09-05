import { Schema } from "effect"

/**
 * Craft, as a check.
 *
 * A prototype is only worth annotating if it does not look like every other generated page, so
 * the model gets told when it reaches for the tropes. The checks are greppy on purpose — cheap,
 * deterministic, and wrong often enough that each finding carries the snippet it fired on, so
 * the model can disagree. They never block anything and never wake a turn: they ride along in
 * the `design_preview` output, which the model is already reading.
 *
 * The rules and their hex lists follow the P0 set in open-design's `lint-artifact.ts`
 * (nexu-ui/open-design, Apache-2.0), reduced to the ones that hold outside its design-system
 * seeds. Display-face and slide-deck rules assume a seed we do not ship, so they stay out.
 */

export const Finding = Schema.Struct({
  id: Schema.String,
  message: Schema.String,
  fix: Schema.String,
  snippet: Schema.optional(Schema.String),
})
export type Finding = typeof Finding.Type

// Tailwind violet / purple, then indigo — the generated-page palette.
const PURPLE = [
  "#a855f7", "#9333ea", "#7c3aed", "#6d28d9", "#581c87",
  "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe",
  "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81",
  "#818cf8", "#a5b4fc", "#c7d2fe", "#e0e7ff", "#eef2ff",
]

// A single solid use of these is the tell, gradient or not.
const DEFAULT_INDIGO = ["#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#8b5cf6", "#7c3aed", "#a855f7"]

// Tailwind blue/sky and cyan: the two ends of the "trust" gradient.
const BLUE = [
  "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a", "#60a5fa", "#93c5fd", "#bfdbfe",
  "#0ea5e9", "#0284c7", "#0369a1", "#38bdf8", "#7dd3fc",
]
const CYAN = ["#06b6d4", "#0891b2", "#0e7490", "#155e75", "#164e63", "#22d3ee", "#67e8f9", "#a5f3fc"]

const EMOJI = ["✨", "🚀", "🎯", "⚡", "🔥", "💡", "📈", "🎨", "🛡️", "🌟", "💪", "🎉", "👋", "🙌", "✅", "⭐", "🏆"]

const INVENTED_METRIC = [
  /\b10×\s+(faster|better|easier)\b/i,
  /\b100×\s+(faster|better)\b/i,
  /\b99\.\d+%\s+uptime\b/i,
  /\bzero[- ]downtime\b/i,
  /\b3×\s+more\s+(productive|efficient)\b/i,
]

const FILLER = [
  /\bfeature\s+(one|two|three|1|2|3)\b/i,
  /\blorem\s+ipsum\b/i,
  /\bdolor\s+sit\s+amet\b/i,
  /\bplaceholder\s+text\b/i,
  /\bsample\s+content\b/i,
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const clip = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > 160 ? flat.slice(0, 157) + "…" : flat
}

/**
 * A `:root { --accent: #6366f1 }` block is the design system speaking, not the model defaulting,
 * so token-only blocks under a global selector are removed before the indigo scan. Any other token
 * name carrying the hex is still laundering it, and stays in.
 */
function withoutTokenBlocks(html: string) {
  return html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open: string, css: string, close: string) => {
    const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "")
    const stripped = cleaned.replace(/([^{}]*)\{([^{}]*)\}/g, (full: string, selector: string, body: string) => {
      const sel = selector.trim()
      if (!/^(:root|html|\[data-theme=[^\]]*\])(\s*,\s*(:root|html|\[data-theme=[^\]]*\]))*$/.test(sel)) return full
      const decls = body
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
      if (decls.length === 0) return full
      if (!decls.every((d) => /^--[\w-]+\s*:/.test(d))) return full
      const launders = decls.some((d) => !/^--accent\s*:/.test(d) && DEFAULT_INDIGO.some((h) => d.toLowerCase().includes(h)))
      if (launders) return full
      return ""
    })
    return `${open}${stripped}${close}`
  })
}

function gradients(html: string) {
  return html.match(/linear-gradient\([^)]*\)/gi) ?? []
}

/** Every rule is independent; adding one means appending here. At most one finding per rule. */
export function lint(raw: string): Finding[] {
  const out: Finding[] = []
  if (!raw) return out
  // Comments hold examples ("paste a <section> here") that would otherwise fire.
  const html = raw.replace(/<!--[\s\S]*?-->/g, "")

  // purple gradient — the original generated-page look
  const purple = gradients(html).find((g) => {
    const lower = g.toLowerCase()
    return PURPLE.some((h) => lower.includes(h)) || /\b(purple|violet)\b/.test(lower)
  })
  if (purple) {
    out.push({
      id: "purple-gradient",
      message: "A violet/purple gradient background.",
      fix: "Use a flat surface, or the accent at one intensity — not in a gradient.",
      snippet: clip(purple),
    })
  }

  // blue→cyan two-stop "trust" gradient — the SaaS hero cliché
  if (!purple) {
    const trust = gradients(html).find((g) => {
      const lower = g.toLowerCase()
      const blue = BLUE.some((h) => lower.includes(h)) || /\bblue\b/.test(lower)
      const cyan = CYAN.some((h) => lower.includes(h)) || /\bcyan\b/.test(lower)
      return blue && cyan
    })
    if (trust) {
      out.push({
        id: "trust-gradient",
        message: "A blue→cyan two-stop gradient.",
        fix: "Use a flat surface or a single colour from the prototype's own tokens.",
        snippet: clip(trust),
      })
    }
  }

  // default indigo as accent — the most-reported tell, even as a solid
  if (!purple) {
    const scan = withoutTokenBlocks(html)
    for (const hex of DEFAULT_INDIGO) {
      const m = new RegExp(escape(hex), "i").exec(scan)
      if (!m) continue
      out.push({
        id: "default-indigo",
        message: `The default LLM accent (${hex}) used directly.`,
        fix: "Pick an accent for this design and declare it once as --accent in :root; if indigo is the choice, declaring it there makes it a choice.",
        snippet: clip(m[0]),
      })
      break
    }
  }

  // emoji as feature icons — only in structural spots, not prose
  for (const e of EMOJI) {
    if (!html.includes(e)) continue
    const m = new RegExp(`<(?:h[1-6]|button|li|span class="[^"]*icon[^"]*")[^>]*>[^<]*${escape(e)}`, "i").exec(html)
    if (!m) continue
    out.push({
      id: "emoji-icon",
      message: `Emoji "${e}" used as a UI icon.`,
      fix: "A small inline SVG (thin stroke, currentColor), or no icon at all.",
      snippet: clip(m[0]),
    })
    break
  }

  // rounded card with a coloured left border — the canonical generated card
  const card = /\.[a-z-]+\s*\{[^}]*border-left\s*:\s*\d+px\s+solid\s+[^;]+;[^}]*border-radius\s*:\s*[1-9]/i.exec(html)
  if (card) {
    out.push({
      id: "left-accent-card",
      message: "A rounded card with a coloured left border.",
      fix: "Drop the border-left, or the radius. Hairline borders all round read as designed.",
      snippet: clip(card[0]),
    })
  }

  // invented metrics
  for (const re of INVENTED_METRIC) {
    const m = re.exec(html)
    if (!m) continue
    out.push({
      id: "invented-metric",
      message: `A number nobody measured: "${m[0]}".`,
      fix: "Remove the claim, or leave a labelled stub until the user supplies a real figure.",
      snippet: clip(m[0]),
    })
    break
  }

  // filler copy
  for (const re of FILLER) {
    const m = re.exec(html)
    if (!m) continue
    out.push({
      id: "filler-copy",
      message: `Filler copy: "${m[0]}".`,
      fix: "Write copy specific to this design, or delete the section. An empty section is a composition problem, not a words problem.",
      snippet: clip(m[0]),
    })
    break
  }

  // scrollIntoView crosses the iframe boundary and yanks the review window
  if (/\.scrollIntoView\s*\(/.test(html)) {
    out.push({
      id: "scroll-into-view",
      message: "Element.scrollIntoView() scrolls the review window, not just the prototype.",
      fix: "Call scrollTo({ top, behavior: 'smooth' }) on the element that actually scrolls.",
    })
  }

  return out
}

/** The findings as a tool-output paragraph, or nothing when there are none. */
export function report(findings: Finding[]) {
  if (findings.length === 0) return undefined
  return [
    `Craft notes (${findings.length}) — not blocking, but each one is a pattern reviewers recognise as generated:`,
    ...findings.map((f) => `- ${f.id}: ${f.message} ${f.fix}${f.snippet ? ` (at: ${f.snippet})` : ""}`),
  ].join("\n")
}

export * as DesignLint from "./lint"
