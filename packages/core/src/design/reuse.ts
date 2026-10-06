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
 * counts in a style position, and nothing is flagged unless the design system declares the
 * tokens it is compared against.
 */

const SOURCE = /\.(?:tsx|jsx|ts|js|mjs|html|css|vue|svelte)$/
const SCRIPT = /\.(?:tsx|jsx|ts|js|mjs)$/
const FILES = 200
const BYTES = 256 * 1024
/** At most this many checks per rule; the last one says how many more were found. */
const SHOWN = 6
const COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^()]*\)/gi
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

/** The revision's own sources (never its compiled output), read from the blob store, bounded. */
export async function read(blobs: string, files: Readonly<Record<string, string>>): Promise<File[]> {
  const chosen = Object.entries(files)
    .filter(([file, hash]) => !file.startsWith(".compiled/") && SOURCE.test(file) && /^[a-f0-9]{64}$/.test(hash))
    .toSorted(([a], [b]) => a.localeCompare(b))
    .slice(0, FILES)
  const loaded = await Promise.all(
    chosen.map(async ([file, hash]) => {
      const blob = Bun.file(path.join(blobs, hash))
      if (!(await blob.exists()) || blob.size > BYTES) return []
      return [{ file, text: await blob.text() }]
    }),
  )
  return loaded.flat()
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
      return (await sheet.exists()) && sheet.size <= BYTES ? sheet.text() : ""
    }),
  )
  const text = [...excerpts, ...sheets].join("\n")
  if (!text.trim() && !document.system && !document.inventory?.length) return undefined
  return tokens(text)
}

/** Colors and fonts the design system declares, and the effects it uses itself. */
export function tokens(text: string) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "")
  const colors = new Set([...clean.matchAll(COLOR)].flatMap((match) => color(match[0]) ?? []))
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
    /** Custom properties or at least three color literals: enough to call a literal color off-token. */
    declaresColors: /--[\w-]+\s*:/.test(clean) || colors.size >= 3,
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
}

/** Reuse findings and the reuse evidence of one revision. */
export function check(input: Input): { checks: Design.AuditCheck[]; reuse?: Design.AuditReuse } {
  const scripts = input.engine === "html" ? [] : input.files.filter((file) => SCRIPT.test(file.file))
  const names = new Set(input.inventory.map((entry) => entry.name))
  const declared = scripts.flatMap((file) => {
    const imported = new Set(imports(file.text).flatMap((item) => item.names))
    return [...file.text.matchAll(/(?:^|[\s;(){}])(?:function\s*\*?\s*|class\s+|(?:const|let|var)\s+)([A-Z][\p{L}\p{N}_$]*)/gmu)]
      .filter((match) => names.has(match[1]!) && !imported.has(match[1]!))
      .map((match) => ({ name: match[1]!, file: file.file, line: line(file.text, match.index + match[0].search(/[^\s;(){}]/)) }))
  })
  const redeclared = declared.filter((item, index) => declared.findIndex((other) => other.name === item.name) === index)
  const used = scripts.flatMap((file) =>
    imports(file.text).flatMap((item) => {
      const target = resolve(item.specifier, input.aliases)
      if (!target) return []
      const matched = input.inventory.filter((entry) => {
        const stem = entry.file.replace(/\.[^/.]+$/, "").replace(/\/index$/, "")
        return stem === target || stem.endsWith(`/${target}`) || entry.root === target || entry.root.endsWith(`/${target}`)
      })
      if (!matched.length) return []
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
      const entry = input.inventory.find((component) => component.name === item.name)!
      return {
        rule: "redeclared-component",
        key: `redeclared-component@${item.name}`,
        severity: "review" as const,
        selector: `source ${item.file}:${item.line}`,
        evidence: `${item.name} is declared in ${item.file} (line ${item.line}) while the design system exports ${item.name} from ${entry.file}.${more(index, shown.length, redeclared.length, "re-declared components")}`,
        fix: `Import it instead: import { ${item.name} } from "${DesignInventory.specifier(entry.file, input.aliases)}". Keep a local component only when it composes or extends the design-system one, and name it differently.`,
        width: input.width,
      }
    }),
    ...offToken(input),
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

function offToken(input: Input): Design.AuditCheck[] {
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
          return [{ kind: "color" as const, value, file: file.file, line: line(text, match.index) }]
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
          return [{ kind: "font" as const, value: family, file: file.file, line: line(text, match.index) }]
        })
      : []
    return [...colors, ...fonts]
  })
  const unique = (kind: "color" | "font") =>
    found.filter(
      (item, index) => item.kind === kind && found.findIndex((other) => other.kind === kind && other.value === item.value) === index,
    )
  const colors = unique("color")
  const fonts = unique("font")
  return [
    ...colors.slice(0, SHOWN).map((item, index, shown) => ({
      rule: "color-off-token",
      key: `color-off-token@${item.value}`,
      severity: "review" as const,
      selector: `source ${item.file}:${item.line}`,
      evidence: `Literal color ${item.value} in ${item.file} (line ${item.line}) is not one of the design system's token values.${more(index, shown.length, colors.length, "off-token colors")}`,
      fix: "Use the design system's color token (a CSS custom property or theme class) for this role; add a token to the system only when none fits.",
      width: input.width,
    })),
    ...fonts.slice(0, SHOWN).map((item, index, shown) => ({
      rule: "font-off-system",
      key: `font-off-system@${item.value}`,
      severity: "review" as const,
      selector: `source ${item.file}:${item.line}`,
      evidence: `Font family "${item.value}" in ${item.file} (line ${item.line}) is not a family the design system declares.${more(index, shown.length, fonts.length, "off-system fonts")}`,
      fix: "Use the design system's font tokens or classes; introduce a new family only with a recorded decision.",
      width: input.width,
    })),
  ]
}

/** Import statements and re-exports of one script: the specifier and the names it binds. */
function imports(text: string) {
  return [...text.matchAll(/\b(?:import|export)\s+(?:type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/g)].map((match) => {
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

/** A relative or aliased specifier as a project path stem; undefined for package imports. */
function resolve(spec: string, aliases?: Readonly<Record<string, string>>) {
  const clean = spec.replace(/[?#].*$/, "").replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "")
  const alias = Object.entries(aliases ?? {})
    .map(([find, target]) => ({ find: find.replace(/\/\*?$/, ""), target: DesignInventory.normalize(target) }))
    .find((item) => clean === item.find || clean.startsWith(`${item.find}/`))
  if (alias) return `${alias.target}${clean.slice(alias.find.length)}`.replace(/^\//, "")
  if (/^(?:\.{1,2}\/)+/.test(clean)) return clean.replace(/^(?:\.{1,2}\/)+/, "") || undefined
  if (/^[@~#]\//.test(clean)) return clean.slice(2) || undefined
  return undefined
}

function primary(entries: readonly Design.Component[], file: string) {
  const own = entries.filter((entry) => entry.file === file)
  const base = path.posix.basename(file).replace(/\.[^.]+$/, "").replace(/[-_]/g, "").toLowerCase()
  return (own.find((entry) => entry.name.toLowerCase() === base) ?? own[0])?.name
}

/** A color literal in one canonical form: lowercase 6-digit hex when opaque sRGB, else compact. */
function color(literal: string) {
  const value = literal.toLowerCase().replace(/\s+/g, " ").trim()
  const hex = /^#([0-9a-f]+)$/.exec(value)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex
    return `#${full.length === 8 && full.endsWith("ff") ? full.slice(0, 6) : full}`
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value)
  if (rgb && (rgb[4] === undefined || rgb[4] === "1" || rgb[4] === "100%"))
    return `#${rgb
      .slice(1, 4)
      .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0"))
      .join("")}`
  return value.replace(/\s*([(),/])\s*/g, "$1")
}

function neutral(value: string) {
  return /^#(?:000000|ffffff)(?:[0-9a-f]{2})?$/.test(value) || /^rgba?\((?:0,0,0|255,255,255)[,)]/.test(value.replace(/ /g, ","))
}

function families(value: string) {
  return value
    .split(",")
    .map((family) => family.trim().replace(/^["'`]|["'`]$/g, "").trim().toLowerCase())
    .filter(Boolean)
}

function line(text: string, index: number) {
  return text.slice(0, index).split("\n").length
}

function more(index: number, shown: number, total: number, label: string) {
  return index === shown - 1 && total > shown ? ` ${total - shown} more ${label} not listed.` : ""
}
