import { afterAll, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { readdir, stat } from "node:fs/promises"
import { DesignAppBinary } from "../src/design/app-binary"
import { tmpdir } from "./fixture/tmpdir"

// A local stand-in for GitHub: the releases API and the design-v<version> release downloads, with
// archives built here so the checksums, manifests and protocols are the ones each test needs.
const PROTOCOL = 7
const assets = new Map<string, Uint8Array<ArrayBuffer> | string>()
const requests: string[] = []
const failing = { releases: false }
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const route = new URL(request.url).pathname
    requests.push(route)
    if (route === "/releases" && failing.releases) return new Response("rate limited", { status: 403 })
    const body = assets.get(route)
    if (body === undefined) return new Response("not found", { status: 404 })
    return new Response(body)
  },
})
const base = { download: `${server.url}download`, releases: `${server.url}releases` }

afterAll(() => server.stop(true))

beforeEach(() => {
  assets.clear()
  requests.length = 0
  failing.releases = false
})

async function publish(input: { version: string; protocol?: number; tamper?: boolean }) {
  await using staging = await tmpdir()
  await Bun.write(path.join(staging.path, "redcode-design"), `#!/bin/sh\necho ${input.version}\n`)
  // Relative names only: GNU tar on Windows reads `C:\...` as a remote archive.
  const tar = Bun.spawn(["tar", "-czf", "archive.tar.gz", "redcode-design"], { cwd: staging.path, stderr: "pipe" })
  const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()])
  if (code !== 0) throw new Error(`tar exited with ${code}: ${stderr}`)
  const archive = await Bun.file(path.join(staging.path, "archive.tar.gz")).bytes()
  const manifest = JSON.stringify({ version: input.version, protocol: input.protocol ?? PROTOCOL })
  const digest = (bytes: Uint8Array<ArrayBuffer> | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  const root = `/download/design-v${input.version}`
  assets.set(`${root}/manifest.json`, manifest)
  assets.set(`${root}/redcode-design-linux-x64.tar.gz`, archive)
  assets.set(
    `${root}/SHA256SUMS`,
    `${digest(manifest)}  manifest.json\n${input.tamper ? "0".repeat(64) : digest(archive)}  redcode-design-linux-x64.tar.gz\n`,
  )
}

function releases(tags: { tag: string; draft?: boolean; prerelease?: boolean }[]) {
  assets.set(
    "/releases",
    JSON.stringify(tags.map((item) => ({ tag_name: item.tag, draft: !!item.draft, prerelease: !!item.prerelease }))),
  )
}

const options = (bin: string, extra: Partial<DesignAppBinary.Options> = {}): DesignAppBinary.Options => ({
  ...base,
  protocol: PROTOCOL,
  minimum: "0.1.0",
  bin,
  target: "linux-x64",
  source: false,
  env: {},
  ...extra,
})

test("downloads a release, verifies it against SHA256SUMS, installs it and reuses the installed binary", async () => {
  await using bin = await tmpdir()
  await publish({ version: "0.2.0" })
  const command = await DesignAppBinary.command(options(bin.path, { version: "0.2.0" }))
  const file = path.join(bin.path, "redcode-design-0.2.0")
  expect(command).toEqual([file])
  expect(await Bun.file(file).text()).toBe("#!/bin/sh\necho 0.2.0\n")
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o111).toBe(0o111)
  expect(await Bun.file(path.join(bin.path, "redcode-design-0.2.0.json")).json()).toEqual({
    version: "0.2.0",
    protocol: PROTOCOL,
  })
  expect(requests).toEqual([
    "/download/design-v0.2.0/manifest.json",
    "/download/design-v0.2.0/SHA256SUMS",
    "/download/design-v0.2.0/redcode-design-linux-x64.tar.gz",
  ])
  // Nothing but the two installed files is left behind.
  expect((await readdir(bin.path)).sort()).toEqual(["redcode-design-0.2.0", "redcode-design-0.2.0.json"])

  requests.length = 0
  expect(await DesignAppBinary.command(options(bin.path, { version: "0.2.0" }))).toEqual([file])
  expect(requests).toEqual([])
})

test("refuses an archive whose checksum does not match SHA256SUMS and installs nothing", async () => {
  await using bin = await tmpdir()
  await publish({ version: "0.2.0", tamper: true })
  await expect(DesignAppBinary.command(options(bin.path, { version: "0.2.0" }))).rejects.toThrow(
    "refusing to install it",
  )
  expect(await readdir(bin.path)).toEqual([])
})

test("refuses a release of another protocol before downloading its archive", async () => {
  await using bin = await tmpdir()
  await publish({ version: "0.2.0", protocol: PROTOCOL + 1 })
  await expect(DesignAppBinary.command(options(bin.path, { version: "0.2.0" }))).rejects.toThrow(
    `speaks protocol ${PROTOCOL + 1} but this redcode speaks ${PROTOCOL}`,
  )
  expect(requests).toEqual(["/download/design-v0.2.0/manifest.json"])
  expect(await readdir(bin.path)).toEqual([])
})

test("REDCODE_DESIGN_BIN wins over the checkout source, which wins over a release", async () => {
  await using bin = await tmpdir()
  const entry = path.join(bin.path, "index.ts")
  expect(
    await DesignAppBinary.command(
      options(bin.path, { env: { REDCODE_DESIGN_BIN: "/opt/redcode-design" }, source: entry }),
    ),
  ).toEqual(["/opt/redcode-design"])
  expect(await DesignAppBinary.command(options(bin.path, { source: entry }))).toEqual([process.execPath, entry])
  // Unless told otherwise, a redcode run from this checkout with Bun runs the app from its source.
  expect(await DesignAppBinary.command(options(bin.path, { source: undefined }))).toEqual([
    process.execPath,
    path.resolve(import.meta.dir, "../../design-app/src/index.ts"),
  ])
  expect(requests).toEqual([])
})

test("latest runs the newest published release that speaks the protocol", async () => {
  await using bin = await tmpdir()
  releases([
    { tag: "design-v0.4.0", draft: true },
    { tag: "design-v0.3.0" },
    { tag: "v0.51.0" },
    { tag: "design-v0.2.0" },
    { tag: "design-v0.1.1-rc.1", prerelease: true },
    { tag: "design-v0.0.9" },
  ])
  await publish({ version: "0.3.0", protocol: PROTOCOL + 1 })
  await publish({ version: "0.2.0" })
  expect(await DesignAppBinary.command(options(bin.path, { version: "latest" }))).toEqual([
    path.join(bin.path, "redcode-design-0.2.0"),
  ])
  expect(requests.filter((route) => route.endsWith("manifest.json"))).toEqual([
    "/download/design-v0.3.0/manifest.json",
    "/download/design-v0.2.0/manifest.json",
    "/download/design-v0.2.0/manifest.json",
  ])
})

test("latest falls back to the newest installed compatible release when releases cannot be listed", async () => {
  await using bin = await tmpdir()
  await publish({ version: "0.2.0" })
  await DesignAppBinary.command(options(bin.path, { version: "0.2.0" }))
  await Bun.write(path.join(bin.path, "redcode-design-0.9.0.json"), JSON.stringify({ version: "0.9.0", protocol: 1 }))
  failing.releases = true
  expect(await DesignAppBinary.command(options(bin.path, { version: "latest" }))).toEqual([
    path.join(bin.path, "redcode-design-0.2.0"),
  ])

  await using empty = await tmpdir()
  await expect(DesignAppBinary.command(options(empty.path, { version: "latest" }))).rejects.toThrow(
    "Could not list design app releases",
  )
})

test("refuses a pinned version older than the release redcode was built with", async () => {
  await using bin = await tmpdir()
  await expect(DesignAppBinary.command(options(bin.path, { version: "0.0.9" }))).rejects.toThrow("older than 0.1.0")
  await expect(DesignAppBinary.command(options(bin.path, { version: "newest" }))).rejects.toThrow(
    'must be "latest" or an exact version',
  )
  expect(requests).toEqual([])
})

test("the default is the release redcode was built with", async () => {
  await using bin = await tmpdir()
  await publish({ version: "0.1.0" })
  expect(await DesignAppBinary.command(options(bin.path))).toEqual([path.join(bin.path, "redcode-design-0.1.0")])
})

test("names archives the way the design app release publishes them", () => {
  expect(DesignAppBinary.archive("linux-x64-baseline-musl")).toBe("redcode-design-linux-x64-baseline-musl.tar.gz")
  expect(DesignAppBinary.archive("darwin-arm64")).toBe("redcode-design-darwin-arm64.zip")
  expect(DesignAppBinary.archive("windows-x64")).toBe("redcode-design-windows-x64.zip")
})
