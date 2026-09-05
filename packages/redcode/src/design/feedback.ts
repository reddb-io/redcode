/**
 * Turning what a browser said into what the model reads.
 *
 * The prototype page is the least trusted thing in the system: it is model-generated, it may embed
 * text from anywhere, and it runs in front of a person who is about to act on it. So the browser
 * never composes a prompt. It sends annotations — a selector, what the user typed, optionally what
 * they had selected — and this module renders them, escaped and capped, into one block of text the
 * agent receives as an ordinary user message.
 *
 * The delimiters are not decoration. They tell the model where browser-sourced data begins and
 * ends, so instructions embedded in a prototype's own content read as content rather than as
 * commands.
 */

/** Long enough for a real remark, short enough that a page cannot flood a turn. */
export const LIMITS = {
  items: 50,
  selector: 512,
  label: 200,
  text: 4_000,
  selection: 2_000,
} as const

export interface Annotation {
  /** Where in the prototype, as a CSS path. */
  readonly selector?: string
  /** A human-readable name for that element, for the transcript. */
  readonly label?: string
  /** What the person typed. */
  readonly text: string
  /** What they had selected when they typed it, if anything. */
  readonly selection?: string
}

export interface Context {
  readonly prototype: string
  readonly revision: number
  readonly viewport?: { readonly width: number; readonly height: number }
}

const fence = (value: string) => value.replace(/</g, "‹").replace(/>/g, "›").replace(/"/g, "\u201d")

const clamp = (value: unknown, max: number) => {
  if (typeof value !== "string") return ""
  // Collapsed rather than preserved: a selector or a label spanning lines is either an attack or a
  // mistake, and either way it should not be able to fake structure inside the block. The angle
  // brackets go too — a label is interpolated next to the block's own delimiters.
  const single = fence(value.replace(/\s+/g, " ").trim())
  return single.length > max ? single.slice(0, max) + "…" : single
}

/** Multi-line is legitimate in what a person typed, so only the framing characters are neutralised. */
const body = (value: unknown, max: number) => {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  const capped = trimmed.length > max ? trimmed.slice(0, max) + "…" : trimmed
  return fence(capped)
}

export function normalize(input: readonly unknown[]): Annotation[] {
  return input.slice(0, LIMITS.items).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const raw = item as Record<string, unknown>
    const text = body(raw.text, LIMITS.text)
    if (!text) return []
    const annotation: Annotation = {
      text,
      ...(raw.selector ? { selector: clamp(raw.selector, LIMITS.selector) } : {}),
      ...(raw.label ? { label: clamp(raw.label, LIMITS.label) } : {}),
      ...(raw.selection ? { selection: body(raw.selection, LIMITS.selection) } : {}),
    }
    return [annotation]
  })
}

export function render(annotations: readonly Annotation[], context: Context): string {
  const viewport = context.viewport ? ` viewport="${context.viewport.width}x${context.viewport.height}"` : ""
  const head = `<design-feedback prototype="${clamp(context.prototype, LIMITS.label)}" revision="${context.revision}"${viewport}>`
  const lines = annotations.map((item, index) => {
    const where = item.label || item.selector
    const selection = item.selection ? ` (selected: "${item.selection}")` : ""
    return where ? `${index + 1}. [${where}]${selection} ${item.text}` : `${index + 1}. ${item.text}`
  })
  return [head, ...lines, "</design-feedback>"].join("\n")
}

export * as DesignFeedback from "./feedback"
