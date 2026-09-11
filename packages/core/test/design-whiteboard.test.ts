import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { chromium } from "playwright-core"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignWhiteboard } from "../src/design/whiteboard"

test.each(["fonts/Probe.woff2", "fonts\\Probe.woff2"])(
  "whiteboard loads %s through data URLs in its opaque sandbox",
  async (name) => {
    const font = await Bun.file(new URL("../../app/public/assets/brand/SpaceGrotesk.woff2", import.meta.url)).bytes()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const network: string[] = []
      page.on("request", (request) => {
        if (/^https?:/.test(request.url())) network.push(request.url())
      })
      await page.setContent('<iframe sandbox="allow-scripts"></iframe>')
      await page.evaluate(
        (html) => {
          document.querySelector("iframe")!.srcdoc = html
        },
        DesignWhiteboard.render({
          fonts: { [name]: `data:font/woff2;base64,${Buffer.from(font).toString("base64")}` },
          css: "",
          script: `window.EXCALIDRAW_ASSET_PATH = \`\${location.origin}/design/vendor/whiteboard/\`;
            try {
              const url = window.EXCALIDRAW_ASSET_PATH + "fonts/Probe.woff2";
              const response = await fetch(url);
              const face = new FontFace("Probe", 'url("' + url + '")');
              await face.load();
              document.fonts.add(face);
              document.body.dataset.loaded = face.status;
              document.body.dataset.bytes = String((await response.arrayBuffer()).byteLength);
              document.body.dataset.url = response.url;
            } catch (error) {
              document.body.dataset.error = String(error);
            }`,
        }),
      )
      const frame = page.frameLocator("iframe")
      await frame.locator("body[data-loaded],body[data-error]").waitFor({ state: "attached" })
      expect(await frame.locator("body").getAttribute("data-error")).toBeNull()
      expect(await frame.locator("body").getAttribute("data-loaded")).toBe("loaded")
      expect(await frame.locator("body").getAttribute("data-bytes")).toBe(String(font.byteLength))
      expect(await frame.locator("body").getAttribute("data-url")).toStartWith("data:font/woff2;base64,")
      expect(network).toEqual([])
    } finally {
      await browser.close()
    }
  },
  30000,
)

/** A release served from memory: the tarball, its SHA256SUMS line, and a fresh data directory. */
async function release(input: {
  script: string
  archive?: Uint8Array<ArrayBuffer>
  sums?: (digest: string) => string
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-whiteboard-"))
  const bundle = path.join(root, "bundle")
  await mkdir(path.join(bundle, "fonts"), { recursive: true })
  await Bun.write(path.join(bundle, "whiteboard.js"), input.script)
  await Bun.write(path.join(bundle, "whiteboard.css"), "body{margin:0}")
  await Bun.write(path.join(bundle, "fonts", "Probe.woff2"), new Uint8Array([0x77, 0x4f, 0x46, 0x32]))
  // Relative names only: GNU tar on Windows treats `C:\...` as a remote archive and exits with 2.
  const tar = Bun.spawn(["tar", "-czf", "bundle.tar.gz", "-C", "bundle", "."], { cwd: root, stderr: "pipe" })
  const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()])
  if (code !== 0) throw new Error(`tar exited with ${code}: ${stderr}`)
  const archive = input.archive ?? new Uint8Array(await Bun.file(path.join(root, "bundle.tar.gz")).arrayBuffer())
  const digest = new Bun.CryptoHasher("sha256").update(archive).digest("hex")
  const asset = `redcode-whiteboard-${version}.tar.gz`
  const assets: Record<string, string | Uint8Array<ArrayBuffer>> = {
    SHA256SUMS: input.sums?.(digest) ?? `${digest}  redcode-linux-x64.tar.gz\n${digest}  ${asset}\n`,
    [asset]: archive,
  }
  const requests: string[] = []
  const data = path.join(root, "data")
  DesignWhiteboard.configure({
    version,
    data,
    checkout: path.join(root, "missing"),
    fetch: async (url) => {
      const name = url.split("/").at(-1)!
      requests.push(name)
      const body = assets[name]
      if (body === undefined) return new Response("not found", { status: 404 })
      return new Response(body)
    },
  })
  return { root, data, assets, requests, asset, digest, release: path.join(data, "design", "whiteboard", version) }
}

async function entries(data: string) {
  return (await readdir(path.join(data, "design", "whiteboard")).catch(() => [])).sort()
}

const version = "9.9.9"

test("whiteboard unpacks a release whose tarball matches its SHA256SUMS entry", async () => {
  const fixture = await release({ script: "window.PROBE = 'verified bundle'" })
  try {
    const html = await DesignWhiteboard.frame()
    expect(html).toContain("window.PROBE = 'verified bundle'")
    expect(html).toContain("body{margin:0}")
    expect(html).toContain('"fonts/Probe.woff2":"data:font/woff2;base64,')
    expect(fixture.requests).toEqual(["SHA256SUMS", fixture.asset])
    expect(await Bun.file(path.join(fixture.release, "whiteboard.js")).exists()).toBe(true)
    expect(await entries(fixture.data)).toEqual([version])
    // Served from the cache: no second download.
    expect(await DesignWhiteboard.frame()).toBe(html)
    expect(fixture.requests).toHaveLength(2)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("whiteboard refuses a tarball whose checksum mismatches, caches nothing, and retries", async () => {
  const fixture = await release({
    script: "window.PROBE = 'retried bundle'",
    sums: (digest) => `${"0".repeat(64)}  redcode-whiteboard-${version}.tar.gz\n`,
  })
  try {
    const error = await DesignWhiteboard.frame().catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Design.Error)
    expect(error).toMatchObject({ code: "unavailable", message: expect.stringContaining("SHA-256") })
    expect(fixture.requests).toEqual(["SHA256SUMS", fixture.asset])
    expect(await entries(fixture.data)).toEqual([])
    fixture.assets.SHA256SUMS = `${fixture.digest}  ${fixture.asset}\n`
    expect(await DesignWhiteboard.frame()).toContain("window.PROBE = 'retried bundle'")
    expect(fixture.requests).toEqual(["SHA256SUMS", fixture.asset, "SHA256SUMS", fixture.asset])
    expect(await entries(fixture.data)).toEqual([version])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("whiteboard refuses a tarball that SHA256SUMS does not list", async () => {
  const fixture = await release({ script: "", sums: (digest) => `${digest}  redcode-linux-x64.tar.gz\n` })
  try {
    const error = await DesignWhiteboard.frame().catch((error: unknown) => error)
    expect(error).toMatchObject({ code: "unavailable", message: expect.stringContaining("no entry") })
    expect(fixture.requests).toEqual(["SHA256SUMS"])
    expect(await entries(fixture.data)).toEqual([])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("whiteboard is unavailable when SHA256SUMS is missing from the release", async () => {
  const fixture = await release({ script: "" })
  try {
    delete fixture.assets.SHA256SUMS
    const error = await DesignWhiteboard.frame().catch((error: unknown) => error)
    expect(error).toMatchObject({ code: "unavailable", message: expect.stringContaining("HTTP 404") })
    expect(fixture.requests).toEqual(["SHA256SUMS"])
    expect(await entries(fixture.data)).toEqual([])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("whiteboard is unavailable when the network fails or the download times out", async () => {
  const fixture = await release({ script: "" })
  try {
    DesignWhiteboard.configure({
      fetch: () => Promise.reject(new TypeError("Unable to connect")),
    })
    const offline = await DesignWhiteboard.frame().catch((error: unknown) => error)
    expect(offline).toMatchObject({ code: "unavailable", message: expect.stringContaining("Unable to connect") })
    DesignWhiteboard.configure({
      timeout: 20,
      fetch: (_, init) =>
        new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    })
    const stalled = await DesignWhiteboard.frame().catch((error: unknown) => error)
    expect(stalled).toMatchObject({ code: "unavailable", message: expect.stringContaining("timed out") })
    expect(await entries(fixture.data)).toEqual([])
  } finally {
    DesignWhiteboard.configure({ timeout: 60_000 })
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("whiteboard fails cleanly when a listed tarball does not unpack", async () => {
  const fixture = await release({ script: "", archive: new TextEncoder().encode("this is not a gzip stream") })
  try {
    const error = await DesignWhiteboard.frame().catch((error: unknown) => error)
    expect(error).toMatchObject({ code: "unavailable", message: expect.stringContaining("tar exited") })
    expect(fixture.requests).toEqual(["SHA256SUMS", fixture.asset])
    expect(await entries(fixture.data)).toEqual([])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
