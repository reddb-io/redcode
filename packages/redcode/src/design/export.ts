/**
 * One file a person can open from disk or host anywhere.
 *
 * The prototype's own assets — stylesheets, classic scripts, images, fonts, media, and the design
 * assets we ship — are inlined into the document; anything remote is left as a reference for the
 * browser to load. Nothing is fetched, so the export cannot reach out, and every local read is
 * confined to the prototype directory by real path: a symlink inside it cannot carry an outside
 * file into a page that may be shared. The transform itself is lavish-axi's, vendored whole.
 */

import path from "path"
import { promises as fs } from "node:fs"
import { DesignVendor } from "./vendor"
import { buildSelfContainedHtml, exportFileName, splitExportWarnings } from "./vendor/export-bundle.js"

export const DEFAULT_MAX_ASSET_BYTES = 10 * 1024 * 1024
export const DEFAULT_MAX_BUNDLE_BYTES = 25 * 1024 * 1024

export interface Warning {
  readonly kind: string
  readonly ref: string
  readonly reason?: string
}

export interface Result {
  readonly html: string
  /** Local assets that could not be inlined: the export needs them beside it, or looks wrong. */
  readonly unresolved: readonly Warning[]
  /** Everything else worth knowing: a CSP meta left alone, a file URL redacted. */
  readonly notices: readonly Warning[]
}

export interface Options {
  readonly maxAssetBytes?: number
  readonly maxBundleBytes?: number
}

/**
 * A relative `../../vendor/x` from a prototype resolves, on disk, two levels above it — outside
 * the directory, and to a file that does not exist. Those are ours: the read is answered from the
 * shipped assets, so an export renders offline exactly as the review did.
 */
export function vendorAssetFor(absPath: string, root: string): DesignVendor.Asset | undefined {
  const normalized = path.resolve(absPath)
  const expected = path.resolve(root, "..", "..", "vendor")
  if (path.dirname(normalized) !== expected && !normalized.startsWith(expected + path.sep)) return undefined
  const name = path.basename(normalized)
  return DesignVendor.FILES[name]
}

const isOutside = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)
}

/** lavish's default reader, with our vendor directory answered from memory before disk is touched. */
function reader(root: string) {
  return async (
    absPath: string,
    readOptions: { allowOutsideRoot?: boolean; maxAssetBytes?: number; maxBundleRemaining?: number; maxBundleBytes?: number } = {},
  ): Promise<Uint8Array> => {
    const vendor = vendorAssetFor(absPath, root)
    if (vendor) return Buffer.from(vendor.body, "utf8")
    const real = await fs.realpath(absPath)
    if (!readOptions.allowOutsideRoot) {
      let base: string
      try {
        base = await fs.realpath(root)
      } catch {
        base = path.resolve(root)
      }
      if (isOutside(base, real)) {
        throw Object.assign(new Error(`refusing to read ${absPath} outside the prototype directory`), {
          code: "OUTSIDE_ROOT",
        })
      }
    }
    const stats = await fs.stat(real)
    if (Number.isFinite(readOptions.maxAssetBytes) && stats.size > readOptions.maxAssetBytes!) {
      throw Object.assign(new Error(`${stats.size} bytes exceeds per-asset cap ${readOptions.maxAssetBytes}`), {
        code: "TOO_LARGE",
      })
    }
    if (Number.isFinite(readOptions.maxBundleRemaining) && stats.size > readOptions.maxBundleRemaining!) {
      throw Object.assign(new Error(`would exceed per-bundle cap ${readOptions.maxBundleBytes}`), {
        code: "TOO_LARGE",
      })
    }
    return fs.readFile(real)
  }
}

/** A root-absolute `/design/vendor/<name>` is the same asset by its served path. */
function resolveAbsolute(root: string) {
  return (refPath: string): string | null => {
    const match = /^\/design\/vendor\/([A-Za-z0-9._-]{1,64})$/.exec(refPath)
    if (!match || !DesignVendor.FILES[match[1]!]) return null
    return path.resolve(root, "..", "..", "vendor", match[1]!)
  }
}

export async function build(root: string, html: string, options: Options = {}): Promise<Result> {
  // No `confineDir`: lavish's lexical check would turn `../../vendor/x` away before the reader
  // could answer it. The reader confines by real path instead, which is the stronger check.
  const out = await buildSelfContainedHtml(html, {
    baseDir: root,
    readLocalFile: reader(root),
    resolveAbsolute: resolveAbsolute(root),
    maxAssetBytes: options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
    maxBundleBytes: options.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES,
  })
  const { unresolved, notices } = splitExportWarnings(out.warnings)
  return { html: out.html, unresolved, notices }
}

/** `hero` → `hero.export.html`; `report.html` → `report.export.html`. */
export function fileName(name: string): string {
  return exportFileName(name.replace(/\.html?$/i, "") + ".html")
}

/** Where the tool writes when not told: beside the review's own state, never served, never a design file. */
export function defaultOut(root: string, name: string): string {
  return path.join(root, ".review", fileName(name))
}

/** ASCII for every browser, RFC 5987 for the real name. */
export function contentDisposition(name: string): string {
  const filename = fileName(name)
  const ascii =
    Array.from(filename, (char) => {
      const code = char.codePointAt(0) || 0
      return code < 0x20 || code > 0x7e || char === '"' || char === "\\" ? "_" : char
    }).join("") || "prototype.export.html"
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** One line for a person: what did not make it in. */
export function summary(unresolved: number, notices: number): string {
  const assets = unresolved === 1 ? "1 unresolved asset" : `${unresolved} unresolved assets`
  const notes = notices === 1 ? "1 notice" : `${notices} notices`
  if (unresolved > 0 && notices > 0) return `Exported with ${assets} and ${notes}.`
  if (unresolved > 0) return `Exported with ${assets}.`
  if (notices > 0) return `Exported with ${notes}.`
  return "Exported."
}

/** The warnings as lines the agent can act on. */
export function describe(warnings: readonly Warning[]): string[] {
  return warnings.slice(0, 40).map((warning) => `- ${warning.kind}: ${warning.ref}${warning.reason ? ` (${warning.reason})` : ""}`)
}

export * as DesignExport from "./export"
