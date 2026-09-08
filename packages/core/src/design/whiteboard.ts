export * as DesignWhiteboard from "./whiteboard"

import path from "node:path"
import { mkdir, rm, rename } from "node:fs/promises"
import { Global } from "../global"
import { InstallationVersion } from "../installation/version"
import { Design } from "@reddb-io/redcode-schema/design"

let cached: Promise<string> | undefined

/** The existing pinned Excalidraw distribution is an asset, independent of Session execution. */
export function frame() {
  return (cached ??= load().catch((error) => {
    cached = undefined
    throw error
  }))
}

async function load() {
  const release = path.join(Global.Path.data, "design", "whiteboard", InstallationVersion)
  const checkout = path.resolve(import.meta.dir, "../../../redcode/dist/whiteboard")
  const directory =
    process.env.REDCODE_WHITEBOARD_DIR ??
    ((await Bun.file(path.join(checkout, "whiteboard.js")).exists()) ? checkout : release)
  if (!(await Bun.file(path.join(directory, "whiteboard.js")).exists())) {
    if (process.env.REDCODE_WHITEBOARD_DIR || !/^\d+\.\d+\.\d+/.test(InstallationVersion))
      throw new Design.Error({
        code: "unavailable",
        message:
          "Build the whiteboard bundle with bun run build:whiteboard in packages/redcode, or set REDCODE_WHITEBOARD_DIR",
      })
    const response = await fetch(
      `https://github.com/reddb-io/redcode/releases/download/v${InstallationVersion}/redcode-whiteboard-${InstallationVersion}.tar.gz`,
    )
    if (!response.ok)
      throw new Design.Error({ code: "unavailable", message: "Whiteboard bundle is unavailable for this release" })
    const temporary = `${release}-${crypto.randomUUID()}`
    await mkdir(temporary, { recursive: true })
    try {
      await Bun.write(`${temporary}.tar.gz`, response)
      const child = Bun.spawn(["tar", "-xzf", `${temporary}.tar.gz`, "-C", temporary], {
        stdout: "ignore",
        stderr: "pipe",
      })
      if ((await child.exited) !== 0) throw new Error("Unable to unpack whiteboard bundle")
      await mkdir(path.dirname(release), { recursive: true })
      await rename(temporary, release)
    } finally {
      await rm(temporary, { recursive: true, force: true })
      await rm(`${temporary}.tar.gz`, { force: true })
    }
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
  const bootstrap = `const fonts=${JSON.stringify(fonts)};const prefix="https://design-fonts.local/";const originalFetch=window.fetch.bind(window);window.fetch=(input,options)=>originalFetch(typeof input==="string"&&input.startsWith(prefix)?fonts[input.slice(prefix.length)]??input:input,options);const NativeFontFace=window.FontFace;window.FontFace=class extends NativeFontFace{constructor(family,source,descriptors){super(family,typeof source==="string"?source.replace(/https:\\/\\/design-fonts\\.local\\/[^)"']+/g,url=>fonts[url.slice(prefix.length)]??url):source,descriptors)}};`
  const script = (await Bun.file(path.join(directory, "whiteboard.js")).text()).replace(
    "`${location.origin}/design/vendor/whiteboard/`",
    '"https://design-fonts.local/"',
  )
  const css = await Bun.file(path.join(directory, "whiteboard.css")).text()
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src data:; worker-src blob:; form-action 'none'"><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><script type="module">${bootstrap}${script.replaceAll("</script", "<\\/script")}</script></body></html>`
}
