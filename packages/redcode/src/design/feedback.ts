/**
 * Turning what a browser said into what the model reads.
 *
 * The prototype page is the least trusted thing in the system: it is model-generated, it may embed
 * text from anywhere, and it runs in front of a person who is about to act on it. So the browser
 * never composes a prompt. It sends annotations — where, what the person typed, optionally what
 * they had selected, a typed target, an image — and this module renders them, escaped and capped,
 * into one block of text the agent receives as an ordinary user message.
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
  /** The element's own text, as context beside the note. */
  elementText: 240,
  /** Base64 characters, the unit the image normaliser measures in. ~600 KB of pixels. */
  image: 800_000,
  images: 4,
  /** The DOM snapshot that rides along, last, so a model that truncates still reads the words. */
  snapshot: 8_000,
} as const

/** What an attached reference may be. Checked by magic bytes, not by what the browser claims. */
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]

export interface Image {
  readonly mime: ImageMime
  /** Base64, no data: prefix. */
  readonly data: string
}

/** A text range: the words, and anchors that survive a re-render better than the words alone. */
export interface TextRangeTarget {
  readonly type: "text-range"
  readonly text: string
  readonly selector: string
  readonly start: { readonly selector: string; readonly path: readonly number[]; readonly offset: number }
  readonly end: { readonly selector: string; readonly path: readonly number[]; readonly offset: number }
}

/** A table cell, with the visible row and column names when they are provable. */
export interface TableCellTarget {
  readonly type: "table-cell"
  readonly selector: string
  readonly rowLabel: string
  readonly columnLabel: string
  readonly text: string
}

/** A Mermaid node, anchored to the diagram's own ids so a re-render does not lose it. */
export interface MermaidNodeTarget {
  readonly type: "mermaid-node"
  readonly diagramId: string
  readonly nodeId: string
  readonly label: string
  readonly selector: string
}

export type Target = TextRangeTarget | TableCellTarget | MermaidNodeTarget

export interface Annotation {
  /** Where in the prototype, as a CSS path. */
  readonly selector?: string
  /** A human-readable name for that element, for the transcript. */
  readonly label?: string
  /** The element's tag, or `text` / `mermaid-node` / `message` for the other kinds of note. */
  readonly tag?: string
  /** The element's own text, so the remark has a referent even without the page. */
  readonly elementText?: string
  /** What the person typed. */
  readonly text: string
  /** What they had selected when they typed it, if anything. */
  readonly selection?: string
  /** A precise target: a text range, a table cell, a diagram node. */
  readonly target?: Target
  /** A reference they pasted or dropped beside the note. */
  readonly image?: Image
}

export interface Context {
  readonly prototype: string
  readonly revision: number
  readonly viewport?: { readonly width: number; readonly height: number }
  /** The page as a uid/tag/text tree, when the shell sent one. */
  readonly snapshot?: string
  /** Set when the person ended the review with this batch. */
  readonly ended?: "user"
}

const fence = (value: string) => value.replace(/</g, "‹").replace(/>/g, "›").replace(/"/g, "”")

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

/**
 * The bytes decide what an image is. A browser's claimed mime is one more thing a page could set,
 * and the model's image path fails loudly on a mismatch — so anything that is not recognisably one
 * of the three formats, or is too big, is dropped here while the words are kept.
 */
export function image(raw: unknown): Image | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const { data } = raw as Record<string, unknown>
  if (typeof data !== "string" || data.length === 0 || data.length > LIMITS.image) return undefined
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return undefined
  const head = Buffer.from(data.slice(0, 32), "base64")
  const mime = ((): ImageMime | undefined => {
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return "image/png"
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg"
    if (
      head.length >= 12 &&
      head.subarray(0, 4).toString("latin1") === "RIFF" &&
      head.subarray(8, 12).toString("latin1") === "WEBP"
    )
      return "image/webp"
    return undefined
  })()
  return mime ? { mime, data } : undefined
}

const anchor = (raw: unknown) => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    selector: clamp(r.selector, LIMITS.selector),
    path: Array.isArray(r.path)
      ? r.path.slice(0, 32).map((n) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0))
      : [],
    offset: Number.isInteger(r.offset) && (r.offset as number) >= 0 ? (r.offset as number) : 0,
  }
}

/** A target is reduced to a fixed shape before it reaches the agent; anything else is dropped. */
export function target(raw: unknown): Target | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const r = raw as Record<string, unknown>
  switch (r.type) {
    case "text-range": {
      const text = body(r.text, LIMITS.selection)
      if (!text) return undefined
      return {
        type: "text-range",
        text,
        selector: clamp(r.selector ?? r.commonAncestorSelector, LIMITS.selector),
        start: anchor(r.start),
        end: anchor(r.end),
      }
    }
    case "table-cell":
      return {
        type: "table-cell",
        selector: clamp(r.selector, LIMITS.selector),
        rowLabel: clamp(r.rowLabel, LIMITS.elementText),
        columnLabel: clamp(r.columnLabel, LIMITS.elementText),
        text: clamp(r.text, LIMITS.elementText),
      }
    case "mermaid-node":
      return {
        type: "mermaid-node",
        diagramId: clamp(r.diagramId, LIMITS.label),
        nodeId: clamp(r.nodeId, LIMITS.label),
        label: clamp(r.label, LIMITS.elementText),
        selector: clamp(r.selector, LIMITS.selector),
      }
    default:
      return undefined
  }
}

export function normalize(input: readonly unknown[]): Annotation[] {
  let images = 0
  return input.slice(0, LIMITS.items).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const raw = item as Record<string, unknown>
    // The review client calls the person's words `prompt`; older shells and tests call them `text`.
    const text = body(raw.prompt ?? raw.text, LIMITS.text)
    if (!text) return []
    const attached = images < LIMITS.images ? image(raw.image) : undefined
    if (attached) images++
    const typed = target(raw.target)
    const elementText = typed
      ? undefined
      : clamp(raw.elementText ?? (raw.prompt !== undefined ? raw.text : undefined), LIMITS.elementText)
    const annotation: Annotation = {
      text,
      ...(raw.selector ? { selector: clamp(raw.selector, LIMITS.selector) } : {}),
      ...(raw.label ? { label: clamp(raw.label, LIMITS.label) } : {}),
      ...(raw.tag ? { tag: clamp(raw.tag, 40) } : {}),
      ...(elementText ? { elementText } : {}),
      ...(raw.selection ? { selection: body(raw.selection, LIMITS.selection) } : {}),
      ...(typed ? { target: typed } : {}),
      ...(attached ? { image: attached } : {}),
    }
    return [annotation]
  })
}

/** The images, in the order the notes mention them, as the prompt's file parts. */
export function attachments(annotations: readonly Annotation[]) {
  return annotations.flatMap((item, index) =>
    item.image
      ? [
          {
            type: "file" as const,
            mime: item.image.mime,
            filename: `design-feedback-${index + 1}.${item.image.mime === "image/jpeg" ? "jpg" : item.image.mime.slice(6)}`,
            url: `data:${item.image.mime};base64,${item.image.data}`,
          },
        ]
      : [],
  )
}

/** Where a note points, in one bracket a reader and a model both understand. */
export function where(item: Annotation): string {
  const t = item.target
  if (t?.type === "text-range") return `text "${t.text}" in ${t.selector}`
  if (t?.type === "table-cell") {
    const cell = [t.rowLabel, t.columnLabel].filter(Boolean).join(" → ")
    const own = item.tag && item.tag !== "td" && item.tag !== "th" ? `${item.tag} in ` : ""
    return cell ? `${own}cell ${cell} (${t.selector})` : `${own}cell ${t.selector}`
  }
  if (t?.type === "mermaid-node") {
    const ids = [t.diagramId ? `#${t.diagramId}` : "", t.nodeId ? `#${t.nodeId}` : ""].filter(Boolean).join(" ")
    return `node ${t.label ? `"${t.label}"` : ""}${ids ? ` ${ids}` : ""}`.replace(/\s+/g, " ").trim()
  }
  if (item.tag === "message") return ""
  return item.label || item.selector || ""
}

export function render(annotations: readonly Annotation[], context: Context): string {
  const viewport = context.viewport ? ` viewport="${context.viewport.width}x${context.viewport.height}"` : ""
  const ended = context.ended ? ` ended="${context.ended}"` : ""
  const head = `<design-feedback prototype="${clamp(context.prototype, LIMITS.label)}" revision="${context.revision}"${viewport}${ended}>`
  const lines = annotations.map((item, index) => {
    const at = where(item)
    const own = item.elementText && !item.target ? ` (it says: "${item.elementText}")` : ""
    const selection = item.selection && !item.target ? ` (selected: "${item.selection}")` : ""
    const image = item.image ? ` (image attached: design-feedback-${index + 1})` : ""
    return at ? `${index + 1}. [${at}]${own}${selection} ${item.text}${image}` : `${index + 1}. ${item.text}${image}`
  })
  const tail = context.ended
    ? ["", "The person ended the review with this batch. Do not wait for more notes; finish and report."]
    : []
  const snapshot = context.snapshot
    ? ["", "<dom-snapshot>", body(context.snapshot, LIMITS.snapshot), "</dom-snapshot>"]
    : []
  return [head, ...lines, ...tail, ...snapshot, "</design-feedback>"].join("\n")
}

export * as DesignFeedback from "./feedback"
