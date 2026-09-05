import type { Finding } from "./lint"

/**
 * What kind of thing the prototype is.
 *
 * A screen, a flow between screens, two options side by side, a deck: each is prototyped
 * differently and each is judged differently. Naming the kind lets the checks be specific and the
 * plan say what it inherited. The default is a screen, which is what design mode did before kinds
 * existed, so nothing already written changes meaning.
 */

export const KINDS = ["screen", "flow", "comparison", "deck"] as const
export type Kind = (typeof KINDS)[number]
export const DEFAULT: Kind = "screen"

export interface Definition {
  readonly kind: Kind
  /** One line for the prompt. */
  readonly summary: string
  /** What the prototype must contain, as the model reads it. */
  readonly contract: string
}

export const DEFINITIONS: Record<Kind, Definition> = {
  screen: {
    kind: "screen",
    summary: "one surface, in every state that decides it",
    contract:
      'Mark the element that renders each state with data-state="loading|empty|error|populated|edge". All five, even if some are a toggle away.',
  },
  flow: {
    kind: "flow",
    summary: "several steps the user moves through, in order",
    contract:
      'Each step is an element with data-step="1", data-step="2", … and the prototype has a way to move between them. The step that fetches carries the five data-state cases.',
  },
  comparison: {
    kind: "comparison",
    summary: "two or more options, side by side, for the user to pick one",
    contract:
      'Each option is an element with data-option="a", data-option="b", … rendered side by side in the same viewport, at the same fidelity. When the user picks, record it in `decisions`.',
  },
  deck: {
    kind: "deck",
    summary: "slides, one section each, for presenting the idea",
    contract:
      'Each slide is <section class="slide light|dark|hero light|hero dark">, exactly one theme class per slide. Vary the theme: three of the same in a row reads as fatigue.',
  },
}

export function isKind(value: unknown): value is Kind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value)
}

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "")

/** Findings in the lint's shape, so `design_preview` reports them the same way. */
export function check(kind: Kind, html: string): Finding[] {
  const source = stripComments(html)
  const out: Finding[] = []
  if (kind === "flow") {
    const steps = new Set([...source.matchAll(/data-step\s*=\s*["']?\s*([\w-]+)/gi)].map((m) => m[1]))
    if (steps.size < 2) {
      out.push({
        id: "flow-single-step",
        message: `A flow with ${steps.size === 0 ? "no" : "one"} data-step.`,
        fix: 'Mark each step with data-step="1", data-step="2", … and give the user a way to move between them.',
      })
    }
  }
  if (kind === "comparison") {
    const options = new Set([...source.matchAll(/data-option\s*=\s*["']?\s*([\w-]+)/gi)].map((m) => m[1]))
    if (options.size < 2) {
      out.push({
        id: "comparison-single-option",
        message: `A comparison with ${options.size === 0 ? "no" : "one"} data-option.`,
        fix: 'Render at least two options side by side, each marked data-option="…", at the same fidelity.',
      })
    }
  }
  if (kind === "deck") {
    const slides = source.match(/<section\s[^>]*class\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>/gi) ?? []
    if (slides.length === 0) {
      out.push({
        id: "deck-no-slides",
        message: 'A deck with no <section class="slide">.',
        fix: 'One <section class="slide …"> per slide.',
      })
    } else {
      const theme = (tag: string) => {
        const cls = /class\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ""
        if (/\bhero\b/.test(cls) && /\bdark\b/.test(cls)) return "HD"
        if (/\bhero\b/.test(cls) && /\blight\b/.test(cls)) return "HL"
        if (/\bdark\b/.test(cls)) return "D"
        if (/\blight\b/.test(cls)) return "L"
        return undefined
      }
      const themes = slides.map(theme)
      const untagged = themes.filter((t) => t === undefined).length
      if (untagged > 0) {
        out.push({
          id: "slide-theme-missing",
          message: `${untagged} of ${slides.length} slides have no theme class.`,
          fix: "Every slide carries exactly one of: light, dark, hero light, hero dark.",
        })
      }
      const tone = (t: string | undefined) =>
        t === "L" || t === "HL" ? "light" : t === "D" || t === "HD" ? "dark" : undefined
      for (let i = 0; i + 2 < themes.length; i++) {
        const a = tone(themes[i])
        if (a && a === tone(themes[i + 1]) && a === tone(themes[i + 2])) {
          out.push({
            id: "slide-rhythm",
            message: `Three ${a} slides in a row at ${i + 1}–${i + 3}.`,
            fix: "Swap the middle one to the opposite theme.",
          })
          break
        }
      }
    }
  }
  return out
}

export * as DesignKinds from "./kinds"
