/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
export * as DesignSignature from "./signature.js"

import path from "node:path"
import { Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { DesignFiles } from "./files.js"

/**
 * A structural signature of one rendered direction: what its layout is made of, never what its copy
 * says, so the same composition in another language signs the same. Fields, separated by `;`:
 * L landmark/section order (runs collapsed as `section*3`), C multi-column grid/flex containers in
 * document order (`g3` a three-track grid, `f4` a four-item row), H heading counts per level 1-6,
 * P dominant text and surface colors (each channel quantized to 3 bits), F first font families,
 * V log2 buckets of the class-token and tag vocabularies, T text-length buckets in display columns,
 * where an East Asian wide character counts two, so a translation lands in the buckets its rendered
 * width does (≤12, ≤40, ≤120, longer), N rendered element count.
 *
 * An audit signs every direction once, at the widest viewport it renders (the target's widest
 * standard width: the widest configured breakpoint for web, the wider phone for app, 1920 for
 * presentation), so grids are compared uncollapsed; signatures taken at different widths are never
 * compared. v1 signatures counted text in code points and were taken at the narrowest viewport.
 */
export const VERSION = "v2"

/**
 * Conservative thresholds: within a revision two directions are too similar when their structure is
 * at least 90% alike, whatever their colors (a recolor is not a new composition). A new design
 * matches an approved one only when structure is at least 95% alike and the whole signature 92%,
 * because designs of one application share the design system's paint by intent. Directions under
 * twenty rendered elements are too small to judge and are never compared. A direction with fewer
 * than `structure` landmark, column and heading tokens has too little layout to compare (two
 * different layouts made of plain boxes would look alike): it matches only an identical signature.
 */
export const THRESHOLD = {
  variants: 0.9,
  approved: { structure: 0.95, score: 0.92 },
  elements: 20,
  structure: 3,
} as const

/** The computed style fields a signature reads; the browser uses getComputedStyle, tests pass a reader. */
export interface Style {
  readonly display: string
  readonly gridTemplateColumns: string
  readonly flexDirection: string
  readonly color: string
  readonly backgroundColor: string
  readonly fontFamily: string
}

/**
 * Runs inside the rendered page (self-contained so page.evaluate can serialize it): the signature of
 * the variant root named `variant`, or of the body. `scope` and `read` exist for tests on a parsed
 * document; the browser passes neither.
 */
export function capture(variant: string | null, scope?: Document, read?: (element: Element) => Style) {
  const doc = scope ?? document
  const style = read ?? ((element: Element) => getComputedStyle(element))
  const root = variant
    ? [...doc.querySelectorAll("[data-design-variant]")].find(
        (element) => element.getAttribute("data-design-variant") === variant,
      )
    : doc.body
  if (!root) return ""
  const skipped = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"])
  const hidden = new Set<Element>()
  const elements = [root, ...root.querySelectorAll("*")].slice(0, 4000).filter((element) => {
    if (skipped.has(element.tagName.toUpperCase())) return false
    if (element.parentElement && hidden.has(element.parentElement)) {
      hidden.add(element)
      return false
    }
    if (style(element).display === "none") {
      hidden.add(element)
      return false
    }
    return true
  })
  const roles: Record<string, string> = {
    banner: "header",
    navigation: "nav",
    main: "main",
    region: "section",
    complementary: "aside",
    contentinfo: "footer",
    form: "form",
    search: "form",
    dialog: "dialog",
    table: "table",
    grid: "table",
  }
  const landmarkTags = new Set(["header", "nav", "main", "section", "article", "aside", "footer", "form", "table", "dialog"])
  const collapse = (tokens: string[], limit: number) =>
    tokens
      .reduce<{ token: string; count: number }[]>((runs, token) => {
        const last = runs.at(-1)
        if (last?.token === token) return [...runs.slice(0, -1), { token, count: last.count + 1 }]
        return [...runs, { token, count: 1 }]
      }, [])
      .map((run) => (run.count > 1 ? `${run.token}*${run.count}` : run.token))
      .slice(0, limit)
  const landmarks = collapse(
    elements.flatMap((element) => {
      const tag = element.tagName.toLowerCase()
      const role = roles[element.getAttribute("role") ?? ""]
      if (role) return [role]
      if (landmarkTags.has(tag)) return [tag]
      if ((tag === "ul" || tag === "ol") && element.children.length >= 3) return ["list"]
      return []
    }),
    32,
  )
  const tracks = (value: string) => {
    const repeated = /^repeat\(\s*(\d+)/.exec(value.trim())
    if (repeated) return Number(repeated[1])
    if (!value || value === "none") return 0
    // Computed values list resolved tracks; named lines in brackets and nested functions are not tracks.
    let depth = 0
    let count = 0
    let inside = false
    for (const character of value.replace(/\[[^\]]*\]/g, " ")) {
      if (character === "(") depth++
      if (character === ")") depth--
      const space = /\s/.test(character) && depth === 0
      if (!space && !inside) count++
      inside = !space
    }
    return count
  }
  const columns = collapse(
    elements.flatMap((element) => {
      const computed = style(element)
      if (computed.display === "grid" || computed.display === "inline-grid") {
        const count = tracks(computed.gridTemplateColumns)
        return count >= 2 ? [`g${Math.min(count, 12)}`] : []
      }
      if (
        (computed.display === "flex" || computed.display === "inline-flex") &&
        !computed.flexDirection.startsWith("column")
      ) {
        const count = [...element.children].filter((child) => !hidden.has(child) && !skipped.has(child.tagName.toUpperCase())).length
        return count >= 2 ? [`f${Math.min(count, 9)}`] : []
      }
      return []
    }),
    24,
  )
  const headings = [0, 0, 0, 0, 0, 0]
  for (const element of elements) {
    const named = /^h([1-6])$/i.exec(element.tagName)
    const level = named
      ? Number(named[1])
      : element.getAttribute("role") === "heading"
        ? Math.min(Math.max(Number(element.getAttribute("aria-level") ?? 2) || 2, 1), 6)
        : 0
    if (level) headings[level - 1]++
  }
  const quantize = (value: string) => {
    const color = value.trim().toLowerCase().replace(/\s+/g, "")
    if (!color || color === "transparent" || color === "rgba(0,0,0,0)") return ""
    const hex = /^#([0-9a-f]{3,8})$/.exec(color)?.[1]
    const channels = hex
      ? (hex.length <= 4 ? [...hex.slice(0, 3)].map((digit) => digit + digit) : [0, 2, 4].map((at) => hex.slice(at, at + 2))).map(
          (pair) => parseInt(pair, 16),
        )
      : /^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(color)?.slice(1, 5)
    if (!channels) return color.slice(0, 24)
    if (!hex && channels[3] !== undefined && Number(channels[3]) === 0) return ""
    return channels
      .slice(0, 3)
      .map((channel) => Math.min(7, Math.floor(Number(channel) / 32)))
      .join("")
  }
  const paint = new Map<string, number>()
  for (const element of elements) {
    const computed = style(element)
    for (const value of [computed.color, computed.backgroundColor]) {
      const token = quantize(value ?? "")
      if (token) paint.set(token, (paint.get(token) ?? 0) + 1)
    }
  }
  const colors = [...paint]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([token]) => token)
  const fonts = [
    ...new Set(
      elements
        .map((element) =>
          (style(element).fontFamily ?? "")
            .split(",")[0]!
            .trim()
            .replace(/^["']|["']$/g, "")
            .toLowerCase()
            .replace(/[.;=]/g, "_"),
        )
        .filter(Boolean),
    ),
  ]
    .toSorted()
    .slice(0, 4)
  const bucket = (count: number) => Math.round(Math.log2(count + 1))
  const classes = new Set(elements.flatMap((element) => [...element.classList]))
  const tags = new Set(elements.map((element) => element.tagName.toLowerCase()))
  const text = [0, 0, 0, 0]
  // East Asian wide characters (Han, kana, Hangul, full-width forms) take two columns when rendered.
  const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿！-｠￠-￦]/u
  for (const element of elements) {
    const own = [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim()
      .replace(/\s+/gu, " ")
    if (!own) continue
    const span = [...own].reduce((sum, character) => sum + (wide.test(character) ? 2 : 1), 0)
    text[span <= 12 ? 0 : span <= 40 ? 1 : span <= 120 ? 2 : 3]++
  }
  return [
    "v2",
    `L=${landmarks.join(".")}`,
    `C=${columns.join(".")}`,
    `H=${headings.join(".")}`,
    `P=${colors.join(".")}`,
    `F=${fonts.join(".")}`,
    `V=${bucket(classes.size)}.${bucket(tags.size)}`,
    `T=${text.join(".")}`,
    `N=${elements.length}`,
  ].join(";")
}

export interface Parsed {
  readonly landmarks: readonly string[]
  readonly columns: readonly string[]
  readonly headings: readonly number[]
  readonly colors: readonly string[]
  readonly fonts: readonly string[]
  readonly vocabulary: readonly number[]
  readonly text: readonly number[]
  readonly elements: number
}

export function parse(signature: string): Parsed | undefined {
  const [version, ...fields] = signature.split(";")
  if (version !== VERSION) return undefined
  const field = (key: string) =>
    (fields.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1) ?? "").split(".").filter(Boolean)
  const numbers = (key: string) => field(key).map(Number)
  return {
    landmarks: field("L"),
    columns: field("C"),
    headings: numbers("H"),
    colors: field("P"),
    fonts: field("F"),
    vocabulary: numbers("V"),
    text: numbers("T"),
    elements: Number(field("N")[0] ?? 0),
  }
}

/**
 * How alike two signatures are, from 0 to 1. `structure` weighs layout only (landmarks 35%, columns
 * 30%, heading profile 15%, text-length distribution 10%, vocabulary size 10%), over the components
 * at least one side has: two empty landmark lists are no evidence of likeness, so their weight is
 * dropped rather than scored alike. Below {@link THRESHOLD.structure} tokens on either side, structure
 * is 1 for identical layouts and 0 otherwise. `paint` weighs colors 60% and fonts 40%; `score` is 80%
 * structure and 20% paint.
 */
export function similarity(a: Parsed, b: Parsed) {
  const parts = [
    { weight: 0.35, present: a.landmarks.length + b.landmarks.length, alike: sequence(a.landmarks, b.landmarks) },
    { weight: 0.3, present: a.columns.length + b.columns.length, alike: sequence(a.columns, b.columns) },
    { weight: 0.15, present: total(a.headings) + total(b.headings), alike: distribution(a.headings, b.headings) },
    { weight: 0.1, present: total(a.text) + total(b.text), alike: distribution(a.text, b.text) },
    { weight: 0.1, present: 1, alike: ratio(a.vocabulary, b.vocabulary) },
  ].filter((part) => part.present > 0)
  const enough = (value: Parsed) =>
    value.landmarks.length + value.columns.length + total(value.headings) >= THRESHOLD.structure
  const layout = (value: Parsed) =>
    JSON.stringify([value.landmarks, value.columns, value.headings, value.text, value.vocabulary, value.elements])
  const structure =
    enough(a) && enough(b)
      ? parts.reduce((sum, part) => sum + part.weight * part.alike, 0) / parts.reduce((sum, part) => sum + part.weight, 0)
      : Number(layout(a) === layout(b))
  const paint = 0.6 * jaccard(a.colors, b.colors) + 0.4 * jaccard(a.fonts, b.fonts)
  // Rounded so float error never decides a threshold.
  const round = (value: number) => Math.round(value * 10_000) / 10_000
  return { structure: round(structure), paint: round(paint), score: round(0.8 * structure + 0.2 * paint) }
}

/** One direction's signature as an audit captured it. */
export interface Entry {
  readonly variant?: string
  readonly width: number
  readonly signature: string
}

/** Directions of one revision whose structure repeats an earlier direction's. */
export function repeated(entries: readonly Entry[]): Design.AuditCheck[] {
  const parsed = entries.flatMap((entry) => {
    const value = parse(entry.signature)
    return value && value.elements >= THRESHOLD.elements && entry.variant ? [{ entry, value }] : []
  })
  return parsed.flatMap((current, index) => {
    const earlier = parsed
      .slice(0, index)
      .filter((other) => other.entry.width === current.entry.width)
      .map((other) => ({ other, alike: similarity(other.value, current.value) }))
      .filter((item) => item.alike.structure >= THRESHOLD.variants)
      .toSorted((a, b) => b.alike.structure - a.alike.structure)[0]
    if (!earlier) return []
    const first = earlier.other.entry.variant!
    const second = current.entry.variant!
    return [
      {
        rule: "variants-too-similar",
        key: `variants-too-similar@${first}~${second}`,
        severity: "review" as const,
        selector: `[data-design-variant="${second}"]`,
        evidence: `Variant "${second}" repeats the composition of variant "${first}": structure ${percent(earlier.alike.structure)} alike (landmarks ${describe(current.value.landmarks)}; columns ${describe(current.value.columns)}), colors and fonts ${percent(earlier.alike.paint)} alike.`,
        fix: "Give each direction its own composition (layout, hierarchy, density, navigation), not a recolor or a copy edit of another; or merge the two directions.",
        width: current.entry.width,
        variant: second,
      },
    ]
  })
}

/** An approved design's signature, kept in the application so later designs and conversations can see it. */
export const Approved = Schema.Struct({
  design: Schema.String,
  name: Schema.String,
  revision: Schema.String,
  variant: Schema.String.pipe(Schema.optionalKey),
  signature: Schema.String,
  /** The viewport width the signature was taken at; absent on approvals recorded before widths were kept. */
  width: Schema.Number.pipe(Schema.optionalKey),
  approved: Schema.Number,
})
export interface Approved extends Schema.Schema.Type<typeof Approved> {}
/** The file format this version reads and writes; a newer one is kept untouched. */
export const FORMAT = 1
const decodeFile = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ version: Schema.Literal(FORMAT), designs: Schema.Array(Approved) })),
)
const decodeVersion = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ version: Schema.Number })))

/**
 * Where approved signatures live, next to the generated .red/DESIGN.md of the application, and kept
 * with it under the application's own version control so later designs and conversations see them.
 */
export const FILE = ".red/design-signatures.json"
/** The newest approvals kept; older ones fall off so the file stays small. */
export const KEEP = 40

/**
 * Directions that re-create an approved design other than `design`. Only approvals signed at the
 * entry's width are compared; `skipped` counts the other designs' approvals that were not (signed at
 * another width, before widths were kept, or with an older signature version).
 */
export function matches(entries: readonly Entry[], approved: readonly Approved[], design: string) {
  const others = approved.filter((item) => item.design !== design)
  const references = others.flatMap((item) => {
    const value = parse(item.signature)
    return value && value.elements >= THRESHOLD.elements && item.width !== undefined ? [{ item, value }] : []
  })
  const widths = new Set(entries.map((entry) => entry.width))
  const skipped = others.length - references.filter((reference) => widths.has(reference.item.width!)).length
  const checks = entries.flatMap((entry): Design.AuditCheck[] => {
    const value = parse(entry.signature)
    if (!value || value.elements < THRESHOLD.elements) return []
    const best = references
      .filter((reference) => reference.item.width === entry.width)
      .map((reference) => ({ reference, alike: similarity(reference.value, value) }))
      .filter(
        (candidate) =>
          candidate.alike.structure >= THRESHOLD.approved.structure && candidate.alike.score >= THRESHOLD.approved.score,
      )
      .toSorted((a, b) => b.alike.score - a.alike.score)[0]
    if (!best) return []
    const label = entry.variant ? `Variant "${entry.variant}"` : "The page"
    const source = best.reference.item
    return [
      {
        rule: "matches-approved-design",
        key: `matches-approved-design@${entry.variant ?? "page"}~${source.design}`,
        severity: "review" as const,
        selector: entry.variant ? `[data-design-variant="${entry.variant}"]` : "body",
        evidence: `${label} matches approved design "${source.name}" (${source.design}, revision ${source.revision}${source.variant ? `, variant ${source.variant}` : ""}): structure ${percent(best.alike.structure)} alike, whole signature ${percent(best.alike.score)}.`,
        fix: "When reusing that layout is intended, record it in decisions; otherwise give this design a composition of its own instead of re-creating the approved one.",
        width: entry.width,
        ...(entry.variant ? { variant: entry.variant } : {}),
      },
    ]
  })
  return { checks, skipped }
}

/**
 * Approved signatures recorded for the application: none when the file is missing. An unreadable
 * file or one in a newer format yields none and a `problem`; such a file is never overwritten.
 */
export async function approved(application: string): Promise<{ designs: readonly Approved[]; problem?: string }> {
  const file = Bun.file(path.join(application, FILE))
  if (!(await file.exists())) return { designs: [] }
  const text = await file.text().catch(() => undefined)
  const parsed = text === undefined ? undefined : decodeFile(text)
  if (parsed?._tag === "Some") return { designs: parsed.value.designs }
  const version = text === undefined ? undefined : decodeVersion(text)
  return {
    designs: [],
    problem:
      version?._tag === "Some" && version.value.version > FORMAT
        ? `${FILE} was written in a newer format (${version.value.version}); approved designs were not compared, and the file is kept as it is.`
        : `${FILE} is unreadable; approved designs were not compared, and the file is kept as it is until it is fixed or removed.`,
  }
}

/** Pending writes per signature file, so two approvals in this process never interleave their read-modify-write. */
const writing = new Map<string, Promise<unknown>>()

/**
 * Records an approval's signature, replacing the design's previous one and keeping the newest
 * {@link KEEP}. Writes to one file run one after another; an unreadable or newer-format file is
 * kept and the approval is not recorded (`kept` says why). A write failure rejects.
 */
export function record(application: string, entry: Approved): Promise<{ kept?: string }> {
  const target = path.join(application, FILE)
  const next = (writing.get(target) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = await approved(application)
      if (current.problem) return { kept: current.problem }
      const designs = [entry, ...current.designs.filter((item) => item.design !== entry.design)].slice(0, KEEP)
      await DesignFiles.atomic(target, JSON.stringify({ version: FORMAT, designs }, null, 2) + "\n")
      return {}
    })
  writing.set(target, next)
  return next.finally(() => {
    if (writing.get(target) === next) writing.delete(target)
  })
}

/** The signature an approval keeps: the approved variant's, else the page's, else the only one captured. */
export function chosen<T extends { readonly variant?: string; readonly signature: string }>(
  entries: readonly T[],
  variant?: string,
) {
  return (
    entries.find((entry) => variant !== undefined && entry.variant === variant) ??
    entries.find((entry) => entry.variant === undefined) ??
    (entries.length === 1 ? entries[0] : undefined)
  )
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const describe = (tokens: readonly string[]) => tokens.slice(0, 8).join(" ") || "none"

/** 1 minus the edit distance over the longer length: order matters, as it does in a layout. */
function sequence(a: readonly string[], b: readonly string[]) {
  if (!a.length && !b.length) return 1
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (const [i, left] of a.entries()) {
    let diagonal = row[0]!
    row[0] = i + 1
    for (const [j, right] of b.entries()) {
      const above = row[j + 1]!
      row[j + 1] = Math.min(above + 1, row[j]! + 1, diagonal + (left === right ? 0 : 1))
      diagonal = above
    }
  }
  return 1 - row[b.length]! / Math.max(a.length, b.length)
}

function total(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0)
}

/** Overlap of two count histograms after normalizing each to proportions. */
function distribution(a: readonly number[], b: readonly number[]) {
  const left = total(a)
  const right = total(b)
  if (!left && !right) return 1
  if (!left || !right) return 0
  return Array.from({ length: Math.max(a.length, b.length) }, (_, index) =>
    Math.min((a[index] ?? 0) / left, (b[index] ?? 0) / right),
  ).reduce((sum, value) => sum + value, 0)
}

function jaccard(a: readonly string[], b: readonly string[]) {
  if (!a.length && !b.length) return 1
  const union = new Set([...a, ...b])
  return a.filter((item, index) => b.includes(item) && a.indexOf(item) === index).length / union.size
}

function ratio(a: readonly number[], b: readonly number[]) {
  const pairs = Array.from({ length: Math.max(a.length, b.length) }, (_, index) => [a[index] ?? 0, b[index] ?? 0])
  if (!pairs.length) return 1
  return (
    pairs.reduce((sum, [left, right]) => sum + (Math.max(left!, right!) ? Math.min(left!, right!) / Math.max(left!, right!) : 1), 0) /
    pairs.length
  )
}
