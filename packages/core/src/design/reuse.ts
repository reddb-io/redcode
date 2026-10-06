export * as DesignReuse from "./reuse.js"

import path from "node:path"
import { Design } from "@opencode/schema/design"
import { DesignFiles } from "./files.js"
import { DesignInventory } from "./inventory.js"
import { DesignSystem } from "./system.js"

/**
 * Static design-system reuse checks over a revision's own sources: components re-declared under a
 * design-system component's name instead of imported, and literal colors or fonts the design
 * system's tokens do not declare. Everything here reads code syntax, never copy. Conservative by
 * design: black, white and transparent are never off-token, a hex literal outside a stylesheet only
 * counts in a style position, colors compare in one canonical form with alpha stripped (an alpha
 * variant of a token is the token), a re-declaration needs a component shape, and nothing is flagged
 * unless the design system declares the tokens it is compared against.
 *
 * Every scan is linear in the scanned text and bounded by {@link LIMITS}: at most `files` sources,
 * each at most `bytes`, and `total` bytes in all, in path order; sources past a bound are left out
 * and the check reports how many.
 */

const SOURCE = /\.(?:tsx|jsx|ts|js|mjs|html|css|vue|svelte)$/
const SCRIPT = /\.(?:tsx|jsx|ts|js|mjs)$/
export const LIMITS = { files: 200, bytes: 256 * 1024, total: 4 * 1024 * 1024 } as const
/** At most this many checks per rule; the last one says how many more were found. */
const SHOWN = 6
/** How far past a declaration its component shape is looked for, in characters. */
const WINDOW = 2_000
const COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^()]*\)/gi
/** A custom property holding bare HSL channels (`--muted: 220 14% 96%`), the shadcn token form. */
const CHANNELS = /--[\w-]+\s*:\s*(-?[\d.]+(?:deg|turn|rad|grad)?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*[\d.]+%?\s*)?(?=[;}\n])/g
/** An import or re-export clause: identifiers, braces, commas and `*` only, bounded so a scan stays linear. */
const IMPORT = /\b(?:import|export)\s+(?:type\s+)?([\p{L}\p{N}_$\s,*{}]{0,1500}?)\s*from\s*["']([^"'\n]{1,500})["']/gu
const DECLARATION = /(?:^|[\s;(){}])(function\s*\*?\s*|class\s+|(?:const|let|var)\s+)([A-Z][\p{L}\p{N}_$]*)/gmu
/** JSX after a return, an arrow, an operator or an argument position; a generic like `Array<T>` is not one. */
const JSX = /(?:\breturn\b|=>|[(?:,]|&&|\|\|)\s*\(?\s*<(?:[\p{L}_$][\p{L}\p{N}_$.:-]*[\s/>]|>)|\bcreateElement\(/u
/** A framework's component factory or a styled component, a component without JSX of its own. */
const FACTORY = /^\s*(?::[^=]{0,300})?=\s*(?:React\.)?(?:forwardRef|memo|lazy|observer|defineComponent|component\$|styled(?:\.[\p{L}]+|\())/u
const ARROW = /^\s*(?::[^=]{0,300})?=\s*(?:async\s+)?(?:(?:\([^()]{0,500}\)|[\p{L}_$][\p{L}\p{N}_$]*)\s*(?::[^=]{0,200})?=>|function\b)/u
const EXTENDS = /^\s*(?:<[^>]{0,200}>\s*)?extends\s+[\p{L}\p{N}_$.]*(?:Component|Element)\b/u
/** Native elements a design system usually wraps, by the component name that wraps them. */
const NATIVE = { button: "Button", input: "Input", select: "Select", textarea: "Textarea" } as const
const RAW = /<(button|input|select|textarea)[\s/>]/g
/** A color written where a style expects one: after `:`, `[`, `(`, `,` or a color attribute. */
const POSITION = /(?:[:[(,]|\b(?:fill|stroke|color|stop-color|stopColor|background|bg|bgcolor)\s*=)\s*["'`]?\s*$/
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
  "-apple-system",
  "blinkmacsystemfont",
])

export interface File {
  readonly file: string
  readonly text: string
}

/**
 * The revision's own sources (never its compiled output), read from the blob store within
 * {@link LIMITS}; `skipped` counts the sources a bound left out.
 */
export async function read(blobs: string, files: Readonly<Record<string, string>>) {
  const candidates = Object.entries(files)
    .filter(([file, hash]) => !file.startsWith(".compiled/") && SOURCE.test(file) && /^[a-f0-9]{64}$/.test(hash))
    .toSorted(([a], [b]) => a.localeCompare(b))
  const present = (
    await Promise.all(
      candidates.slice(0, LIMITS.files).map(async ([file, hash]) => {
        const blob = Bun.file(path.join(blobs, hash))
        return (await blob.exists()) ? [{ file, blob }] : []
      }),
    )
  ).flat()
  let total = 0
  const chosen = present.filter((item) => {
    if (item.blob.size > LIMITS.bytes || total + item.blob.size > LIMITS.total) return false
    total += item.blob.size
    return true
  })
  return {
    files: await Promise.all(chosen.map(async (item): Promise<File> => ({ file: item.file, text: await item.blob.text() }))),
    skipped: Math.max(0, candidates.length - LIMITS.files) + present.length - chosen.length,
  }
}

/**
 * The design system's declared tokens: the token, theme and Tailwind sources discovery excerpted plus
 * the configured stylesheets. Undefined when the design has no design system to compare against.
 */
export async function system(document: Pick<Design.Info, "application" | "sources" | "system" | "inventory">) {
  const excerpts = document.sources
    .filter((source) => ["tokens", "tailwind"].includes(DesignSystem.classify(source.file)))
    .map((source) => source.excerpt)
  const sheets = await Promise.all(
    (document.system?.css ?? []).map(async (file) => {
      const resolved = await DesignFiles.resolve(document.application, file).catch(() => undefined)
      if (!resolved) return ""
      const sheet = Bun.file(resolved)
      return (await sheet.exists()) && sheet.size <= LIMITS.bytes ? sheet.text() : ""
    }),
  )
  const text = [...excerpts, ...sheets].join("\n")
  if (!text.trim() && !document.system && !document.inventory?.length) return undefined
  return tokens(text)
}

/** Colors and fonts the design system declares, and the effects it uses itself. */
export function tokens(text: string) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "")
  const colors = new Set([
    ...[...clean.matchAll(COLOR)].flatMap((match) => color(match[0]) ?? []),
    ...[...clean.matchAll(CHANNELS)].flatMap((match) => color(`hsl(${match[1]} ${match[2]} ${match[3]})`) ?? []),
  ])
  const fonts = new Set(
    [
      ...[...clean.matchAll(/(?:font-family|--font[\w-]*)\s*:\s*([^;{}]+)/g)].flatMap((match) => families(match[1]!)),
      ...[...clean.matchAll(/fontFamily\s*:\s*\{([\s\S]*?)\}/g)].flatMap((match) =>
        [...match[1]!.matchAll(/["'`]([^"'`]+)["'`]/g)].flatMap((item) => families(item[1]!)),
      ),
    ].filter((family) => !GENERIC.has(family)),
  )
  return {
    colors,
    fonts,
    /**
     * At least three declared colors (literals or HSL channel tokens): enough to call a literal color
     * off-token. Custom properties alone (a radius, a spacing scale) declare no colors.
     */
    declaresColors: colors.size >= 3,
    gradient: /gradient\(/.test(clean) && /background-clip\s*:\s*text|bg-clip-text/.test(clean),
    glass: /backdrop-filter|backdrop-blur/.test(clean),
  }
}

export interface Input {
  readonly engine: Design.Info["engine"]
  readonly files: readonly File[]
  readonly inventory: readonly Design.Component[]
  readonly tokens: ReturnType<typeof tokens> | undefined
  readonly aliases?: Readonly<Record<string, string>>
  readonly width: number
  /**
   * The design root relative to the application, so a relative import resolves to the project path
   * it names; without it a relative import counts only when it names a design-system path exactly.
   */
  readonly base?: string
  /** Sources a {@link LIMITS} bound left out of the scan; the check reports them. */
  readonly skipped?: number
}

/** Reuse findings and the reuse evidence of one revision. */
export function check(input: Input): { checks: Design.AuditCheck[]; reuse?: Design.AuditReuse } {
  const scripts = (input.engine === "html" ? [] : input.files.filter((file) => SCRIPT.test(file.file))).map((file) => ({
    ...file,
    imports: imports(file.text),
  }))
  const components = new Map(input.inventory.map((entry) => [entry.name, entry]))
  const located = locate(input.inventory)
  const lines = positions(input.files)
  const declared = scripts.flatMap((file) => {
    const imported = new Set(file.imports.flatMap((item) => item.names))
    return [...file.text.matchAll(DECLARATION)]
      .filter((match) => components.has(match[2]!) && !imported.has(match[2]!) && component(file.text, match))
      .map((match) => ({ name: match[2]!, file: file.file, index: match.index + match[0].search(/[^\s;(){}]/) }))
  })
  const redeclared = [...Map.groupBy(declared, (item) => item.name).values()].map((group) => group[0]!)
  const used = scripts.flatMap((file) =>
    file.imports.flatMap((item) => {
      const matched =
        resolve(item.specifier, file.file, input.base, input.aliases)
          .map((target) => located.get(target) ?? [])
          .find((entries) => entries.length) ?? []
      const all = item.namespace || item.names.length === 0
      return matched
        .filter((entry) => all || item.names.includes(entry.name) || (item.default && entry.name === primary(matched, entry.file)))
        .map((entry) => ({ name: entry.name, file: entry.file }))
    }),
  )
  const imported = [...new Set(used.map((item) => item.name))].toSorted()
  const files = [...new Set(used.map((item) => item.file))].toSorted()
  const checks = [
    ...redeclared.slice(0, SHOWN).map((item, index, shown) => {
      const entry = components.get(item.name)!
      const at = lines(item.file, item.index)
      return {
        rule: "redeclared-component",
        key: `redeclared-component@${item.name}`,
        severity: "review" as const,
        selector: `source ${item.file}:${at}`,
        evidence: `${item.name} is declared in ${item.file} (line ${at}) while the design system exports ${item.name} from ${entry.file}.${more(index, shown.length, redeclared.length, "re-declared components")}`,
        fix: `Import it instead: import { ${item.name} } from "${DesignInventory.specifier(entry.file, input.aliases)}". Keep a local component only when it composes or extends the design-system one, and name it differently.`,
        width: input.width,
      }
    }),
    ...offToken(input, lines),
    ...native(scripts, components, input, lines),
    ...(input.skipped
      ? [
          {
            rule: "reuse-scan-limit",
            key: "reuse-scan-limit",
            severity: "info" as const,
            selector: "sources",
            evidence: `${input.skipped} source file${input.skipped === 1 ? " was" : "s were"} not scanned for design-system reuse: the scan reads at most ${LIMITS.files} files, each up to ${LIMITS.bytes / 1024} KB and ${LIMITS.total / 1024 / 1024} MB in all. The reuse findings cover the scanned files only.`,
            fix: "Check the unscanned sources by hand, or split large generated files out of the prototype.",
            width: input.width,
          },
        ]
      : []),
  ]
  const total = imported.length + redeclared.length
  return {
    checks,
    ...(scripts.length && input.inventory.length
      ? {
          reuse: {
            imported,
            redeclared: redeclared.map((item) => item.name),
            files,
            ...(total ? { ratio: imported.length / total } : {}),
          },
        }
      : {}),
  }
}

/** One line of the reuse evidence for an audit report. */
export function describe(reuse: Design.AuditReuse) {
  return `Design-system reuse: ${reuse.imported.length} component${reuse.imported.length === 1 ? "" : "s"} imported${reuse.imported.length ? ` (${reuse.imported.slice(0, 12).join(", ")}${reuse.imported.length > 12 ? ", …" : ""}) from ${reuse.files.length} file${reuse.files.length === 1 ? "" : "s"}` : ""}; ${reuse.redeclared.length} re-declared${reuse.redeclared.length ? ` (${reuse.redeclared.join(", ")})` : ""}${reuse.ratio === undefined ? "" : `; reuse ${Math.round(reuse.ratio * 100)}%`}.`
}

/** What an audit records when the reuse check itself failed: evidence that it did not run, never a failed audit. */
export function unavailable(reason: string, width: number): Design.AuditCheck {
  return {
    rule: "reuse-check-unavailable",
    key: "reuse-check-unavailable",
    severity: "info",
    selector: "sources",
    evidence: `The design-system reuse check could not run: ${reason.slice(0, 300)}`,
    fix: "Check component reuse, colors and fonts against the design system by hand, or run the audit again.",
    width,
  }
}

function offToken(input: Input, lines: Lines): Design.AuditCheck[] {
  const system = input.tokens
  if (!system) return []
  const found = input.files.flatMap((file) => {
    const sheet = file.file.endsWith(".css")
    const text = sheet ? file.text.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length)) : file.text
    const colors = system.declaresColors
      ? [...text.matchAll(COLOR)].flatMap((match) => {
          const value = color(match[0])
          if (!value || neutral(value) || system.colors.has(value)) return []
          if (!sheet && !POSITION.test(text.slice(Math.max(0, match.index - 24), match.index))) return []
          return [{ kind: "color" as const, value, file: file.file, index: match.index }]
        })
      : []
    const fonts = system.fonts.size
      ? [
          ...[...text.matchAll(/font-family\s*:\s*([^;{}\n]+)/g)].map((match) => ({ value: match[1]!, index: match.index })),
          ...[...text.matchAll(/fontFamily\s*:\s*(["'`])([^"'`]+)\1/g)].map((match) => ({
            value: match[2]!,
            index: match.index,
          })),
        ].flatMap((match) => {
          const family = families(match.value)[0]
          if (!family || GENERIC.has(family) || family.startsWith("var(") || system.fonts.has(family)) return []
          return [{ kind: "font" as const, value: family, file: file.file, index: match.index }]
        })
      : []
    return [...colors, ...fonts]
  })
  // The first occurrence of each value, in order; line numbers are counted only for the shown ones.
  const unique = (kind: "color" | "font") =>
    [...Map.groupBy(found.filter((item) => item.kind === kind), (item) => item.value).values()].map((group) => ({
      ...group[0]!,
      line: 0,
    }))
  const shown = (items: ReturnType<typeof unique>) =>
    items.slice(0, SHOWN).map((item) => ({ ...item, line: lines(item.file, item.index) }))
  const colors = unique("color")
  const fonts = unique("font")
  return [
    ...shown(colors).map((item, index, listed) => ({
      rule: "color-off-token",
      key: `color-off-token@${item.value}`,
      severity: "review" as const,
      selector: `source ${item.file}:${item.line}`,
      evidence: `Literal color ${item.value} in ${item.file} (line ${item.line}) is not one of the design system's token values.${more(index, listed.length, colors.length, "off-token colors")}`,
      fix: "Use the design system's color token (a CSS custom property or theme class) for this role; add a token to the system only when none fits.",
      width: input.width,
    })),
    ...shown(fonts).map((item, index, listed) => ({
      rule: "font-off-system",
      key: `font-off-system@${item.value}`,
      severity: "review" as const,
      selector: `source ${item.file}:${item.line}`,
      evidence: `Font family "${item.value}" in ${item.file} (line ${item.line}) is not a family the design system declares.${more(index, listed.length, fonts.length, "off-system fonts")}`,
      fix: "Use the design system's font tokens or classes; introduce a new family only with a recorded decision.",
      width: input.width,
    })),
  ]
}

/**
 * Native controls written where the design system has a component for them (`<button>` with a
 * design-system `Button`), one info check per element: evidence, never a demand, since a native
 * control is sometimes right.
 */
function native(
  scripts: readonly (File & { readonly imports: ReturnType<typeof imports> })[],
  components: ReadonlyMap<string, Design.Component>,
  input: Input,
  lines: Lines,
): Design.AuditCheck[] {
  const found = scripts.flatMap((file) =>
    [...file.text.matchAll(RAW)].flatMap((match) => {
      const tag = match[1] as keyof typeof NATIVE
      const entry = components.get(NATIVE[tag])
      return entry ? [{ tag, entry, file: file.file, index: match.index }] : []
    }),
  )
  return [...Map.groupBy(found, (item) => item.tag).values()].map((group) => {
    const item = group[0]!
    const at = lines(item.file, item.index)
    return {
      rule: "native-element",
      key: `native-element@${item.tag}`,
      severity: "info" as const,
      selector: `source ${item.file}:${at}`,
      evidence: `${group.length} native <${item.tag}> element${group.length === 1 ? "" : "s"} (first in ${item.file}, line ${at}) while the design system exports ${item.entry.name} from ${item.entry.file}.`,
      fix: `Prefer import { ${item.entry.name} } from "${DesignInventory.specifier(item.entry.file, input.aliases)}" unless the native element is deliberate.`,
      width: input.width,
    }
  })
}

/**
 * Whether a declaration matched by {@link DECLARATION} has a component's shape: a component factory
 * or styled component, a class extending a component or element base, or a function or arrow that
 * returns JSX within {@link WINDOW} characters. A capitalized constant (`const Status = {…} as const`)
 * is none of these.
 */
function component(text: string, match: RegExpExecArray) {
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + WINDOW)
  const kind = match[1]!
  if (kind.startsWith("class")) return EXTENDS.test(after) || JSX.test(after)
  if (kind.startsWith("function")) return JSX.test(after)
  return FACTORY.test(after) || (ARROW.test(after) && JSX.test(after))
}

/** Design-system entries by every project path that names them exactly: the file's stem and its root. */
function locate(inventory: readonly Design.Component[]) {
  const located = new Map<string, Design.Component[]>()
  for (const entry of inventory)
    for (const target of new Set([entry.file.replace(/\.[^/.]+$/, "").replace(/\/index$/, ""), entry.root]))
      located.set(target, [...(located.get(target) ?? []), entry])
  return located
}

type Lines = (file: string, index: number) => number

/** Line numbers by character offset, each file's newline index built once and only when asked. */
function positions(files: readonly File[]): Lines {
  const texts = new Map(files.map((file) => [file.file, file.text]))
  const built = new Map<string, number[]>()
  return (file, index) => {
    const breaks = built.get(file) ?? [...(texts.get(file) ?? "").matchAll(/\n/g)].map((match) => match.index)
    built.set(file, breaks)
    // Binary search for the number of line breaks before index.
    let low = 0
    let high = breaks.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (breaks[middle]! < index) {
        low = middle + 1
        continue
      }
      high = middle
    }
    return low + 1
  }
}

/** Import statements and re-exports of one script: the specifier and the names it binds. */
export function imports(text: string) {
  return [...text.matchAll(IMPORT)].map((match) => {
    const clause = match[1]!
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? ""
    return {
      specifier: match[2]!,
      namespace: /\*\s*as\s+/.test(clause) || /^\*$/.test(clause.trim()),
      default: /^[\p{L}_$][\p{L}\p{N}_$]*/u.test(clause.trim()),
      names: named
        .split(",")
        .map((item) => item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean),
    }
  })
}

/**
 * The project path stems an import specifier can name, most specific first; each must equal a
 * design-system file stem or root to count, never merely end with one (`./card` is a local file).
 * An alias resolves through its target; a relative specifier through the importing file and the
 * design root; an unconfigured `@/`, `~/` or `#/` to the path or `src/` and the path; a bare
 * specifier to itself, which only a project path such as `src/components/ui/button` matches.
 */
function resolve(spec: string, from: string, base: string | undefined, aliases?: Readonly<Record<string, string>>) {
  const clean = spec.replace(/[?#].*$/, "").replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "")
  const alias = Object.entries(aliases ?? {})
    .map(([find, target]) => ({ find: find.replace(/\/\*?$/, ""), target: DesignInventory.normalize(target) }))
    .find((item) => clean === item.find || clean.startsWith(`${item.find}/`))
  if (alias) return [`${alias.target}${clean.slice(alias.find.length)}`.replace(/^\//, "")]
  if (/^\.{1,2}\//.test(clean))
    return [
      base === undefined
        ? clean.replace(/^(?:\.{1,2}\/)+/, "")
        : path.posix.normalize(path.posix.join(base, path.posix.dirname(from), clean)).replace(/^\.\//, ""),
    ]
  if (/^[@~#]\//.test(clean)) return [clean.slice(2), `src/${clean.slice(2)}`]
  return [clean]
}

function primary(entries: readonly Design.Component[], file: string) {
  const own = entries.filter((entry) => entry.file === file)
  const base = path.posix.basename(file).replace(/\.[^.]+$/, "").replace(/[-_]/g, "").toLowerCase()
  return (own.find((entry) => entry.name.toLowerCase() === base) ?? own[0])?.name
}

/**
 * A color literal in one canonical form with its alpha stripped, so an alpha variant of a token is
 * the token: sRGB (hex, rgb, hsl) as lowercase 6-digit hex, other spaces as `space(a b c)` with
 * rounded numbers. Undefined when the literal is not a plain color (relative color syntax).
 */
export function color(literal: string) {
  const value = literal.toLowerCase().trim()
  const hex = /^#([0-9a-f]+)$/.exec(value)?.[1]
  if (hex) return `#${(hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex).slice(0, 6)}`
  const call = /^([a-z]+)\((.*)\)$/.exec(value)
  if (!call) return undefined
  const space = call[1]!.replace(/^(rgb|hsl)a$/, "$1")
  // Channels are separated by spaces or commas; a legacy fourth channel and anything after `/` is alpha.
  const channels = call[2]!.split("/")[0]!.split(/[\s,]+/).filter(Boolean).slice(0, 3)
  if (channels.length < 3) return undefined
  const numbers = channels.map((channel) => (channel === "none" ? 0 : parseFloat(channel)))
  if (numbers.some((number) => !Number.isFinite(number))) return undefined
  if (space === "rgb")
    return hexOf(channels.map((channel, index) => (channel.endsWith("%") ? numbers[index]! * 2.55 : numbers[index]!)))
  if (space === "hsl") return hexOf(hsl(hue(channels[0]!, numbers[0]!), numbers[1]! / 100, numbers[2]! / 100))
  const round = (number: number) => Math.round(number * 1000) / 1000
  // oklch and oklab write lightness 0-1 or 0-100%; lab and lch write it 0-100 either way.
  return `${space}(${numbers
    .map((number, index) =>
      round(index === 0 && channels[0]!.endsWith("%") && space.startsWith("ok") ? number / 100 : number),
    )
    .join(" ")})`
}

function hue(channel: string, number: number) {
  if (channel.endsWith("turn")) return number * 360
  if (channel.endsWith("grad")) return number * 0.9
  if (channel.endsWith("rad")) return (number * 180) / Math.PI
  return number
}

/** HSL (hue in degrees, saturation and lightness 0-1) as sRGB channels 0-255. */
function hsl(degrees: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const at = (n: number) => {
    const k = (n + (((degrees % 360) + 360) % 360) / 30) % 12
    return 255 * (lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return [at(0), at(8), at(4)]
}

function hexOf(channels: readonly number[]) {
  return `#${channels.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`
}

function neutral(value: string) {
  return /^#(?:000000|ffffff)$/.test(value) || /^ok(?:lch|lab)\((?:0|1) 0 0\)$/.test(value)
}

function families(value: string) {
  return value
    .split(",")
    .map((family) => family.trim().replace(/^["'`]|["'`]$/g, "").trim().toLowerCase())
    .filter(Boolean)
}

function more(index: number, shown: number, total: number, label: string) {
  return index === shown - 1 && total > shown ? ` ${total - shown} more ${label} not listed.` : ""
}
