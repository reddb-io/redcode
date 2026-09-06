/**
 * Mermaid diagrams as whiteboards.
 *
 * Every rendered diagram in a prototype can be opened as an Excalidraw scene: converted from its
 * Mermaid source, drawn on, rearranged, and handed back to the agent as a summary of what moved
 * plus the scene and a PNG on disk. The agent edits the Mermaid source in response; the scene is
 * never converted back, because a whiteboard is a way of talking about a diagram, not a second
 * copy of it.
 *
 * What lives here is the server's half: the channel token that ties a frame to one prototype, the
 * Mermaid sources recovered from the file on disk (the live DOM has only the rendered SVG), the
 * scene sidecar beside the review's own state, the frame page, and where the bundle is. The bundle
 * itself — Excalidraw, the converter, React — is not in the binary: a release ships it as a tarball
 * the server fetches on first use, and a source checkout builds it with `bun run build:whiteboard`.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "path"
import { Parser } from "htmlparser2"
import { Global } from "@reddb-io/redcode-core/global"
import { InstallationVersion } from "@reddb-io/redcode-core/installation/version"
import { DIR as STATE_DIR } from "./state"
import { sanitizeWhiteboardScene } from "./vendor/whiteboard-core.js"

export const TAG = "whiteboard"
export const CHANNEL_TTL_MS = 5 * 60_000
export const MAX_INDEX = 999
/** A scene with a PNG preview outgrows an ordinary JSON body; only the whiteboard writes get this. */
export const MAX_BODY_BYTES = 20 * 1024 * 1024
export const REPO = "reddb-io/redcode"

// --- the channel ------------------------------------------------------------------------------

/**
 * The frame page is framable by anything, so its token is not a secret an attacker could not
 * obtain; what it proves is that the frame was minted for *this* prototype, recently. The shell
 * additionally requires descent (the frame's parent is the prototype frame) before it listens.
 */
export function mintChannel(secret: Buffer, id: string, now = Date.now()): string {
  const nonce = randomBytes(24).toString("base64url")
  const signature = createHmac("sha256", secret).update(`${now}.${nonce}.${id}`).digest("base64url")
  return `${now}.${nonce}.${signature}`
}

export function verifyChannel(token: unknown, secret: Buffer, id: string, now = Date.now()): boolean {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return false
  const [issuedAtText, nonce, signature, extra] = String(token || "").split(".")
  if (extra !== undefined || !/^\d{13}$/.test(issuedAtText ?? "") || !/^[A-Za-z0-9_-]{32}$/.test(nonce ?? "")) return false
  const issuedAt = Number(issuedAtText)
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > CHANNEL_TTL_MS) return false
  const expected = createHmac("sha256", secret).update(`${issuedAtText}.${nonce}.${id}`).digest("base64url")
  const actual = Buffer.from(signature || "", "utf8")
  const wanted = Buffer.from(expected, "utf8")
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

// --- the sources ------------------------------------------------------------------------------

/** The entity forms that matter for Mermaid syntax (`--&gt;`, `&quot;…`), numeric ones included. */
export function decodeHtmlEntities(text: string): string {
  const cp = (code: number) => (Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "")
  return String(text)
    .replace(/&#(\d+);/g, (_, code) => cp(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => cp(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/** Outer blank lines go, inner indentation stays: Mermaid cares about line structure. */
export function normalizeSource(source: unknown): string {
  return String(source || "")
    .replace(/^[ \t]*\r?\n/, "")
    .trimEnd()
}

export function sourceHash(source: unknown): string {
  return createHash("sha256").update(normalizeSource(source)).digest("hex").slice(0, 16)
}

export interface Source {
  readonly index: number
  readonly source: string
}

const MERMAID_ATTRIBUTES = ["data-redcode-mermaid", "data-lavish-mermaid"]
/** Content a browser never lays out, so the SDK never counts what is inside. */
const INERT = new Set(["template", "noscript"])

/**
 * Mermaid sources in document order, so `index` matches the SDK's own count of containers. The
 * file on disk is authoritative: in the live page each container's text has become an SVG.
 */
export function extractSources(html: unknown): Source[] {
  const out: Source[] = []
  // What is open, innermost last; a container's text is gathered until it closes.
  const open: { name: string; container: boolean; text: string }[] = []
  let inert = 0
  const isMermaid = (name: string, attribs: Record<string, string>) => {
    const className = attribs["class"] ?? ""
    if (className.split(/[\t\n\f\r ]+/).includes("mermaid")) return true
    return MERMAID_ATTRIBUTES.some((attribute) => attribute in attribs)
  }
  const gathering = () => open.filter((entry) => entry.container)
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (inert > 0) {
          inert += 1
          open.push({ name, container: false, text: "" })
          return
        }
        if (INERT.has(name)) {
          inert = 1
          open.push({ name, container: false, text: "" })
          return
        }
        if (name === "br") for (const entry of gathering()) entry.text += "<br/>"
        const container = isMermaid(name, attribs)
        open.push({ name, container, text: "" })
      },
      ontext(text) {
        if (inert > 0) return
        for (const entry of gathering()) entry.text += text
      },
      onclosetag() {
        const entry = open.pop()
        if (!entry) return
        if (inert > 0) {
          inert -= 1
          return
        }
        if (entry.container) out.push({ index: out.length, source: normalizeSource(entry.text) })
      },
    },
    { decodeEntities: true },
  )
  parser.write(String(html || ""))
  parser.end()
  // Document order is the order containers *open*, not close; a diagram inside another container
  // would otherwise be numbered first. Re-number by open order.
  return out.sort((a, b) => a.index - b.index).map((item, index) => ({ index, source: item.source }))
}

// --- the scenes -------------------------------------------------------------------------------

export interface Saved {
  readonly source_hash: string
  readonly text_metrics_version: number
  readonly updated_at: string
  readonly scene: unknown
  readonly baseline: unknown
}

export function isValidIndex(index: unknown): boolean {
  const number = Number(index)
  return Number.isInteger(number) && number >= 0 && number <= MAX_INDEX
}

export function dir(root: string): string {
  return path.join(root, STATE_DIR, "whiteboards")
}

const working = (root: string, index: number) => path.join(dir(root), `${index}.json`)

/** Where the agent reads what the person drew. Absolute, on this machine. */
export function feedbackPaths(root: string, index: number): { scenePath: string; previewPath: string } {
  if (!isValidIndex(index)) throw new Error(`invalid whiteboard diagram index: ${index}`)
  return { scenePath: path.join(dir(root), `${index}.excalidraw`), previewPath: path.join(dir(root), `${index}.png`) }
}

// Saves for one diagram are chained so a slow large write cannot land after a later small one.
const tails = new Map<string, Promise<unknown>>()
let temporaryID = 0
function queued<T>(root: string, index: number, operation: () => Promise<T>): Promise<T> {
  const key = `${path.resolve(root)}\u0000${index}`
  const prior = tails.get(key) ?? Promise.resolve()
  const result = prior.catch(() => undefined).then(operation)
  const tail = result.catch(() => undefined)
  tails.set(key, tail)
  void tail.finally(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return result
}

async function writeAtomic(file: string, content: string | Uint8Array) {
  const temporary = `${file}.${process.pid}.${++temporaryID}.tmp`
  try {
    await fs.writeFile(temporary, content)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** The working scene: editable, with the conversion baseline the summary diffs against. */
export function save(
  root: string,
  index: number,
  input: { sourceHash: unknown; textMetricsVersion?: unknown; scene: unknown; baseline?: unknown },
): Promise<Saved> {
  if (!isValidIndex(index)) throw new Error(`invalid whiteboard diagram index: ${index}`)
  const record: Saved = {
    source_hash: String(input.sourceHash || ""),
    text_metrics_version: Math.max(0, Math.floor(Number(input.textMetricsVersion) || 0)),
    updated_at: new Date().toISOString(),
    scene: sanitizeWhiteboardScene(input.scene),
    baseline: input.baseline ?? null,
  }
  return queued(root, index, async () => {
    await fs.mkdir(dir(root), { recursive: true })
    await writeAtomic(working(root, index), `${JSON.stringify(record)}\n`)
    return record
  })
}

export async function load(root: string, index: number): Promise<Saved | null> {
  if (!isValidIndex(index)) throw new Error(`invalid whiteboard diagram index: ${index}`)
  try {
    const parsed = JSON.parse(await fs.readFile(working(root, index), "utf8")) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object") return null
    return {
      source_hash: String(parsed.source_hash || ""),
      text_metrics_version: Math.max(0, Math.floor(Number(parsed.text_metrics_version) || 0)),
      updated_at: String(parsed.updated_at || ""),
      scene: parsed.scene ?? null,
      baseline: parsed.baseline ?? null,
    }
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return null
    throw error
  }
}

export function decodePng(dataUrl: unknown): Buffer | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""))
  if (!match) return null
  try {
    return Buffer.from(match[1]!, "base64")
  } catch {
    return null
  }
}

/** The agent-facing files: a standalone `.excalidraw` and a PNG, written when the note is queued. */
export function writeFeedbackFiles(
  root: string,
  index: number,
  input: { scene: unknown; pngDataUrl?: unknown },
): Promise<{ scenePath: string; previewPath: string }> {
  const { scenePath, previewPath } = feedbackPaths(root, index)
  const scene = sanitizeWhiteboardScene(input.scene) as { elements?: unknown; appState?: unknown; files?: unknown } | null
  const file = {
    type: "excalidraw",
    version: 2,
    source: "redcode",
    elements: Array.isArray(scene?.elements) ? scene.elements : [],
    appState: scene?.appState && typeof scene.appState === "object" ? scene.appState : {},
    files: scene?.files && typeof scene.files === "object" ? scene.files : {},
  }
  const png = decodePng(input.pngDataUrl)
  return queued(root, index, async () => {
    await fs.mkdir(dir(root), { recursive: true })
    await writeAtomic(scenePath, `${JSON.stringify(file, null, 2)}\n`)
    if (!png) return { scenePath, previewPath: "" }
    await writeAtomic(previewPath, png)
    return { scenePath, previewPath }
  })
}

// --- the frame page ---------------------------------------------------------------------------

export const VENDOR_PREFIX = "/design/vendor/whiteboard/"

export function frameHTML(token: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Whiteboard</title>
<link rel="stylesheet" href="${VENDOR_PREFIX}whiteboard.css">
</head>
<body>
<script>window.__redcodeWhiteboardChannelToken=${JSON.stringify(token).replace(/</g, "\\u003c")};</script>
<script src="${VENDOR_PREFIX}whiteboard.js"></script>
</body>
</html>`
}

/**
 * The frame runs at an opaque origin (the iframe's sandbox), talks to nothing but the vendor
 * route (fonts, and the font bytes Excalidraw embeds in a PNG), and can be framed by the
 * prototype and by the shell.
 */
export function frameCSP(vendor: string): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${vendor}`,
    `style-src 'unsafe-inline' ${vendor}`,
    "img-src data: blob:",
    `font-src data: ${vendor}`,
    `connect-src ${vendor}`,
    "worker-src blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ")
}

// --- the bundle -------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
}

export function assetMime(file: string): string | undefined {
  return MIME[path.extname(file).toLowerCase()]
}

/** A path inside the bundle, or nothing: lexically, then by real path, so a symlink cannot lead out. */
export async function resolveAsset(bundle: string, assetPath: string): Promise<string | undefined> {
  let decoded: string
  try {
    decoded = decodeURIComponent(assetPath)
  } catch {
    return undefined
  }
  if (decoded.includes("\0") || path.isAbsolute(decoded)) return undefined
  const base = path.resolve(bundle)
  const target = path.resolve(base, decoded)
  if (target === base || !target.startsWith(base + path.sep)) return undefined
  if (!assetMime(target)) return undefined
  let real: string
  try {
    real = await fs.realpath(target)
  } catch {
    return undefined
  }
  let realBase: string
  try {
    realBase = await fs.realpath(base)
  } catch {
    realBase = base
  }
  if (!real.startsWith(realBase + path.sep)) return undefined
  return real
}

export const VERSION = InstallationVersion

/** Where a release's bundle is kept once fetched: one directory per version, never mixed. */
export function bundleDir(version = VERSION): string {
  return path.join(Global.Path.data, "designs", "whiteboard", version)
}

export function releaseURL(version = VERSION): string {
  return `https://github.com/${REPO}/releases/download/v${version}/redcode-whiteboard-${version}.tar.gz`
}

const ready = async (candidate: string) =>
  (await fs.stat(path.join(candidate, "whiteboard.js")).catch(() => undefined))?.isFile() ? candidate : undefined

/**
 * The bundle on this machine: a directory the person pointed at, a source checkout's own build,
 * or the release's download. Nothing here fetches.
 */
export async function locate(): Promise<string | undefined> {
  const override = process.env["REDCODE_WHITEBOARD_DIR"]
  if (override) return ready(override)
  const checkout = path.resolve(import.meta.dir, "..", "..", "dist", "whiteboard")
  return (await ready(checkout)) ?? (await ready(bundleDir()))
}

export type DownloadResult = "ready" | "unavailable" | "no-release"

/**
 * Fetch the release's tarball into the version's directory. A source build has no release
 * ("local"), so it says so instead of asking GitHub for a tag that does not exist.
 */
export async function download(version = VERSION, into = bundleDir(version)): Promise<DownloadResult> {
  if (version === "local" || !/^\d+\.\d+\.\d+/.test(version)) return "no-release"
  const response = await fetch(releaseURL(version)).catch(() => undefined)
  if (!response || !response.ok || !response.body) return "unavailable"
  const parent = path.dirname(into)
  await fs.mkdir(parent, { recursive: true })
  const archive = path.join(parent, `${version}.${process.pid}.tar.gz`)
  const staging = `${into}.${process.pid}.tmp`
  try {
    await Bun.write(archive, response)
    await fs.rm(staging, { recursive: true, force: true })
    await fs.mkdir(staging, { recursive: true })
    const untar = Bun.spawn(["tar", "-xzf", archive, "-C", staging], { stdout: "ignore", stderr: "ignore" })
    if ((await untar.exited) !== 0) return "unavailable"
    if (!(await ready(staging))) return "unavailable"
    await fs.rm(into, { recursive: true, force: true })
    await fs.rename(staging, into)
    return "ready"
  } catch {
    return "unavailable"
  } finally {
    await fs.rm(archive, { force: true }).catch(() => undefined)
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

export * as DesignWhiteboard from "./whiteboard"
