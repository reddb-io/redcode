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
  /** Base64 characters, the unit the image normaliser measures in. ~600 KB of pixels. */
  image: 800_000,
  images: 4,
} as const

/** What an attached reference may be. Checked by magic bytes, not by what the browser claims. */
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]

export interface Image {
  readonly mime: ImageMime
  /** Base64, no data: prefix. */
  readonly data: string
}

export interface Annotation {
  /** Where in the prototype, as a CSS path. */
  readonly selector?: string
  /** A human-readable name for that element, for the transcript. */
  readonly label?: string
  /** What the person typed. */
  readonly text: string
  /** What they had selected when they typed it, if anything. */
  readonly selection?: string
  /** A reference they pasted or dropped beside the note. */
  readonly image?: Image
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

export function normalize(input: readonly unknown[]): Annotation[] {
  let images = 0
  return input.slice(0, LIMITS.items).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const raw = item as Record<string, unknown>
    const text = body(raw.text, LIMITS.text)
    if (!text) return []
    const attached = images < LIMITS.images ? image(raw.image) : undefined
    if (attached) images++
    const annotation: Annotation = {
      text,
      ...(raw.selector ? { selector: clamp(raw.selector, LIMITS.selector) } : {}),
      ...(raw.label ? { label: clamp(raw.label, LIMITS.label) } : {}),
      ...(raw.selection ? { selection: body(raw.selection, LIMITS.selection) } : {}),
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

export function render(annotations: readonly Annotation[], context: Context): string {
  const viewport = context.viewport ? ` viewport="${context.viewport.width}x${context.viewport.height}"` : ""
  const head = `<design-feedback prototype="${clamp(context.prototype, LIMITS.label)}" revision="${context.revision}"${viewport}>`
  const lines = annotations.map((item, index) => {
    const where = item.label || item.selector
    const selection = item.selection ? ` (selected: "${item.selection}")` : ""
    const image = item.image ? ` (image attached: design-feedback-${index + 1})` : ""
    return where ? `${index + 1}. [${where}]${selection} ${item.text}${image}` : `${index + 1}. ${item.text}${image}`
  })
  return [head, ...lines, "</design-feedback>"].join("\n")
}

export * as DesignFeedback from "./feedback"
