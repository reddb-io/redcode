import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import os from "os"
import path from "path"
import { mkdtemp, rm, stat } from "node:fs/promises"
import {
  parseChecksums,
  platformFromArchive,
  platformManifest,
  unpackReleaseAssets,
} from "../../script/npm-release-assets"

// The v0.31.2 GitHub Release asset list.
const releaseArchives = [
  "redcode-darwin-arm64.zip",
  "redcode-darwin-x64-baseline.zip",
  "redcode-darwin-x64.zip",
  "redcode-linux-arm64-musl.tar.gz",
  "redcode-linux-arm64.tar.gz",
  "redcode-linux-x64-baseline-musl.tar.gz",
  "redcode-linux-x64-baseline.tar.gz",
  "redcode-linux-x64-musl.tar.gz",
  "redcode-linux-x64.tar.gz",
  "redcode-windows-arm64.zip",
  "redcode-windows-x64-baseline.zip",
  "redcode-windows-x64.zip",
]

describe("platformFromArchive", () => {
  test("maps every release archive to the npm platform package build.ts publishes", () => {
    const keys = releaseArchives.map((file) => platformFromArchive(file)?.key)
    expect(keys).toEqual(releaseArchives.map((file) => file.replace(/\.(tar\.gz|zip)$/, "")))
    expect(platformFromArchive("redcode-whiteboard-0.31.2.tar.gz")).toBeUndefined()
    expect(platformFromArchive("SHA256SUMS")).toBeUndefined()
  })

  test("rejects an archive format build.ts never produces", () => {
    expect(() => platformFromArchive("redcode-linux-x64.zip")).toThrow("unexpected archive format")
    expect(() => platformFromArchive("redcode-windows-x64.tar.gz")).toThrow("unexpected archive format")
  })
})

describe("platformManifest", () => {
  test("matches build.ts field for field", () => {
    expect(platformManifest(platformFromArchive("redcode-linux-x64-baseline-musl.tar.gz")!, "0.31.2")).toEqual({
      name: "@reddb-io/redcode-linux-x64-baseline-musl",
      version: "0.31.2",
      repository: { type: "git", url: "https://github.com/reddb-io/redcode" },
      preferUnplugged: true,
      os: ["linux"],
      cpu: ["x64"],
      libc: ["musl"],
    })
    const windows = platformManifest(platformFromArchive("redcode-windows-arm64.zip")!, "0.31.2")
    expect(windows).toEqual({
      name: "@reddb-io/redcode-windows-arm64",
      version: "0.31.2",
      repository: { type: "git", url: "https://github.com/reddb-io/redcode" },
      preferUnplugged: true,
      os: ["win32"],
      cpu: ["arm64"],
    })
  })
})

// The release job unpacks on ubuntu-latest; GNU tar on Windows reads "C:" in paths as a remote host.
describe.skipIf(process.platform === "win32")("unpackReleaseAssets", () => {
  const scratch: string[] = []
  afterEach(async () => {
    await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function releaseFixture(options: { tamper?: boolean; extra?: string } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), "redcode-npm-release-assets-test-"))
    scratch.push(root)
    const assets = path.join(root, "assets")
    const staging = path.join(root, "staging")
    await $`mkdir -p ${assets} ${staging}`
    await Bun.write(path.join(staging, "redcode"), "#!/bin/sh\necho 0.31.2\n")
    await Bun.write(path.join(staging, "redcode-rpc-sidecar"), "#!/bin/sh\n")
    if (options.extra) await Bun.write(path.join(staging, options.extra), "x")
    await $`tar -czf ${path.join(assets, "redcode-linux-x64.tar.gz")} *`.cwd(staging)
    await Bun.write(path.join(assets, "redcode-whiteboard-0.31.2.tar.gz"), "whiteboard")
    const sums = await $`sha256sum redcode-linux-x64.tar.gz redcode-whiteboard-0.31.2.tar.gz`.cwd(assets).text()
    await Bun.write(
      path.join(assets, "SHA256SUMS"),
      options.tamper ? sums.replace(/^[0-9a-f]/, (c) => (c === "0" ? "1" : "0")) : sums,
    )
    return { assets, dist: path.join(root, "dist") }
  }

  test("unpacks verified archives into dist/<key>/bin with an executable binary and the manifest", async () => {
    const fixture = await releaseFixture()
    const packages = await unpackReleaseAssets({ assetsDir: fixture.assets, distDir: fixture.dist, version: "0.31.2" })
    expect(packages).toEqual(["@reddb-io/redcode-linux-x64"])
    const bin = path.join(fixture.dist, "redcode-linux-x64", "bin")
    expect((await stat(path.join(bin, "redcode"))).mode & 0o111).toBe(0o111)
    expect((await stat(path.join(bin, "redcode-rpc-sidecar"))).mode & 0o111).toBe(0o111)
    expect(await Bun.file(path.join(fixture.dist, "redcode-linux-x64", "package.json")).json()).toEqual(
      platformManifest(platformFromArchive("redcode-linux-x64.tar.gz")!, "0.31.2"),
    )
  })

  test("refuses an archive that does not match SHA256SUMS", async () => {
    const fixture = await releaseFixture({ tamper: true })
    await expect(
      unpackReleaseAssets({ assetsDir: fixture.assets, distDir: fixture.dist, version: "0.31.2" }),
    ).rejects.toThrow("does not match SHA256SUMS")
  })

  test("refuses SHA256SUMS from another version and archives with unexpected members", async () => {
    const fixture = await releaseFixture()
    await expect(
      unpackReleaseAssets({ assetsDir: fixture.assets, distDir: fixture.dist, version: "0.31.3" }),
    ).rejects.toThrow("does not belong to 0.31.3")
    const extra = await releaseFixture({ extra: "payload" })
    await expect(
      unpackReleaseAssets({ assetsDir: extra.assets, distDir: extra.dist, version: "0.31.2" }),
    ).rejects.toThrow("must contain exactly")
  })

  test("parses both sha256sum output styles", () => {
    const hash = "a".repeat(64)
    expect([...parseChecksums(`${hash}  one.tar.gz\n${hash} *two.zip\n`).keys()]).toEqual(["one.tar.gz", "two.zip"])
    expect(() => parseChecksums("nope")).toThrow("malformed")
  })
})
