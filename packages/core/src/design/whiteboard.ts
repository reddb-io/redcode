export * as DesignWhiteboard from "./whiteboard"

import path from "node:path"
import { mkdir, rm, rename } from "node:fs/promises"
import { Global } from "../global"
import { InstallationVersion } from "../installation/version"
import { Design } from "@reddb-io/redcode-schema/design"

let cached: Promise<string> | undefined

/** Where a release's whiteboard bundle comes from and where it lands once verified. */
export interface Source {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>
  version: string
  data: string
  checkout: string
  /** Explicit bundle directory, `REDCODE_WHITEBOARD_DIR`; wins over both the checkout and a release. */
  directory: string | undefined
  timeout: number
}

let source: Source = {
  fetch: globalThis.fetch,
  version: InstallationVersion,
  data: Global.Path.data,
  checkout: path.resolve(import.meta.dir, "../../../redcode/dist/whiteboard"),
  directory: process.env.REDCODE_WHITEBOARD_DIR,
  timeout: 60_000,
}

/** Repoints the loader and forgets the cached frame, so a suite can serve a release from memory. */
export function configure(input: Partial<Source>) {
  source = { ...source, ...input }
  cached = undefined
}

/** The existing pinned Excalidraw distribution is an asset, independent of Session execution. */
export function frame() {
  return (cached ??= load().catch((error) => {
    cached = undefined
    throw error
  }))
}

async function download(asset: string) {
  const url = `https://github.com/reddb-io/redcode/releases/download/v${source.version}/${asset}`
  return source
    .fetch(url, { signal: AbortSignal.timeout(source.timeout) })
    .then((response) => {
      if (response.ok) return response.bytes()
      throw new Design.Error({
        code: "unavailable",
        message: `Whiteboard bundle is unavailable for this release: ${asset} returned HTTP ${response.status}`,
      })
    })
    .catch((error: unknown) => {
      if (error instanceof Design.Error) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new Design.Error({
        code: "unavailable",
        message: `Whiteboard bundle is unavailable: downloading ${asset} failed (${reason})`,
      })
    })
}

async function install(release: string) {
  const asset = `redcode-whiteboard-${source.version}.tar.gz`
  // The release publishes `<sha256>  <file>` lines for every archive it uploads; the bundle is
  // unpacked only once its bytes match the line written for it.
  const sums = new TextDecoder().decode(await download("SHA256SUMS"))
  const expected = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === asset)?.[0]
    ?.toLowerCase()
  if (!expected)
    throw new Design.Error({
      code: "unavailable",
      message: `Whiteboard bundle is unavailable: SHA256SUMS for v${source.version} has no entry for ${asset}`,
    })
  const archive = await download(asset)
  const actual = new Bun.CryptoHasher("sha256").update(archive).digest("hex")
  if (actual !== expected)
    throw new Design.Error({
      code: "unavailable",
      message: `Whiteboard bundle is corrupt: ${asset} has SHA-256 ${actual}, release lists ${expected}; refusing to unpack`,
    })
  const temporary = `${release}-${crypto.randomUUID()}`
  await mkdir(temporary, { recursive: true })
  try {
    await Bun.write(`${temporary}.tar.gz`, archive)
    // GNU tar (first on PATH under Git for Windows) reads a drive letter such as `C:` as a remote
    // host, so tar only ever sees names relative to the release directory.
    const child = Bun.spawn(["tar", "-xzf", `${path.basename(temporary)}.tar.gz`, "-C", path.basename(temporary)], {
      cwd: path.dirname(temporary),
      stdout: "ignore",
      stderr: "pipe",
    })
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (code !== 0)
      throw new Design.Error({
        code: "unavailable",
        message: `Whiteboard bundle is corrupt: tar exited with ${code} unpacking ${asset}: ${stderr.trim()}`,
      })
    if (!(await Bun.file(path.join(temporary, "whiteboard.js")).exists()))
      throw new Design.Error({
        code: "unavailable",
        message: `Whiteboard bundle is corrupt: ${asset} does not contain whiteboard.js`,
      })
    await mkdir(path.dirname(release), { recursive: true })
    await rename(temporary, release)
  } finally {
    await rm(temporary, { recursive: true, force: true })
    await rm(`${temporary}.tar.gz`, { force: true })
  }
}

async function load() {
  const release = path.join(source.data, "design", "whiteboard", source.version)
  const directory =
    source.directory ??
    ((await Bun.file(path.join(source.checkout, "whiteboard.js")).exists()) ? source.checkout : release)
  if (!(await Bun.file(path.join(directory, "whiteboard.js")).exists())) {
    if (source.directory || !/^\d+\.\d+\.\d+/.test(source.version))
      throw new Design.Error({
        code: "unavailable",
        message:
          "Build the whiteboard bundle with bun run build:whiteboard in packages/redcode, or set REDCODE_WHITEBOARD_DIR",
      })
    await install(release)
  }
  const fonts = Object.fromEntries(
    await Promise.all(
      (await Array.fromAsync(new Bun.Glob("fonts/**/*.{woff2,woff,ttf}").scan({ cwd: directory }))).map(
        async (file) => [
          file,
          `data:font/woff2;base64,${Buffer.from(await Bun.file(path.join(directory, file)).bytes()).toString("base64")}`,
        ],
      ),
    ),
  )
  return render({
    fonts,
    script: await Bun.file(path.join(directory, "whiteboard.js")).text(),
    css: await Bun.file(path.join(directory, "whiteboard.css")).text(),
  })
}

export function render(input: { fonts: Record<string, string>; script: string; css: string }) {
  // Filesystem paths from Windows globs become URL keys inside the sandbox.
  const fonts = Object.fromEntries(
    Object.entries(input.fonts).map(([file, data]) => [file.replaceAll("\\", "/"), data]),
  )
  const bootstrap = `const fonts=${JSON.stringify(fonts)};const prefix="https://design-fonts.local/";const originalFetch=window.fetch.bind(window);window.fetch=(input,options)=>originalFetch(typeof input==="string"&&input.startsWith(prefix)?fonts[input.slice(prefix.length)]??input:input,options);const NativeFontFace=window.FontFace;window.FontFace=class extends NativeFontFace{constructor(family,source,descriptors){super(family,typeof source==="string"?source.replace(/https:\\/\\/design-fonts\\.local\\/[^)"']+/g,url=>fonts[url.slice(prefix.length)]??url):source,descriptors)}};`
  const script = input.script.replace("`${location.origin}/design/vendor/whiteboard/`", '"https://design-fonts.local/"')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src data:; worker-src blob:; form-action 'none'"><style>${input.css.replaceAll("</style", "<\\/style")}</style></head><body><script type="module">${bootstrap}${script.replaceAll("</script", "<\\/script")}</script></body></html>`
}
