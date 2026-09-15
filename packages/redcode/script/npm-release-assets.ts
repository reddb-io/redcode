#!/usr/bin/env bun

// Rebuilds the npm platform packages (dist/<key>/bin plus package.json) from the archives of a
// GitHub Release that is already published, so npm ships byte-identical binaries to the ones mise
// users download. Used by red-publish.yml whenever the release exists and must not be rebuilt.
//
// Usage: npm-release-assets.ts <downloaded-assets-dir> <dist-dir> <version>

import { $ } from "bun"
import path from "path"
import { mkdir, readdir, rm } from "node:fs/promises"

const npmScope = "@reddb-io"
const archivePattern = /^(redcode-(linux|darwin|windows)-(x64|arm64)(-baseline)?(-musl)?)\.(tar\.gz|zip)$/

export type PlatformArchive = {
  key: string
  archive: string
  os: "linux" | "darwin" | "win32"
  arch: "x64" | "arm64"
  abi?: "musl"
}

/** Maps a release archive name to the platform package build.ts produces for it. */
export function platformFromArchive(file: string): PlatformArchive | undefined {
  const match = archivePattern.exec(file)
  if (!match) return undefined
  const [, key, os, arch, , abi, extension] = match
  // build.ts packs Linux as tar.gz and everything else as zip.
  if ((os === "linux") !== (extension === "tar.gz")) throw new Error(`unexpected archive format for ${file}`)
  return {
    key,
    archive: file,
    os: os === "windows" ? "win32" : (os as "linux" | "darwin"),
    arch: arch as "x64" | "arm64",
    ...(abi ? { abi: "musl" as const } : {}),
  }
}

/** The platform package.json, field for field as build.ts writes it. */
export function platformManifest(item: PlatformArchive, version: string) {
  return {
    name: `${npmScope}/${item.key}`,
    version,
    repository: { type: "git", url: "https://github.com/reddb-io/redcode" },
    preferUnplugged: true,
    os: [item.os],
    cpu: [item.arch],
    ...(item.abi ? { libc: [item.abi] } : {}),
  }
}

export function parseChecksums(text: string) {
  const entries = new Map<string, string>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line)
    if (!match) throw new Error(`malformed SHA256SUMS line: ${line}`)
    entries.set(match[2], match[1])
  }
  return entries
}

export function expectedBinaries(item: PlatformArchive) {
  const extension = item.os === "win32" ? ".exe" : ""
  return [`redcode${extension}`, `redcode-rpc-sidecar${extension}`].toSorted()
}

async function sha256(file: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  const reader = Bun.file(file).stream().getReader()
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    hasher.update(chunk.value)
  }
  return hasher.digest("hex")
}

async function members(archive: string) {
  const listing = archive.endsWith(".zip") ? await $`unzip -Z1 ${archive}`.text() : await $`tar -tzf ${archive}`.text()
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .toSorted()
}

export async function unpackReleaseAssets(input: { assetsDir: string; distDir: string; version: string }) {
  const checksums = parseChecksums(await Bun.file(path.join(input.assetsDir, "SHA256SUMS")).text())
  // The whiteboard bundle carries the version in its name, which ties this SHA256SUMS to the tag.
  if (!checksums.has(`redcode-whiteboard-${input.version}.tar.gz`))
    throw new Error(`SHA256SUMS does not belong to ${input.version}: no redcode-whiteboard-${input.version}.tar.gz`)

  const platforms: PlatformArchive[] = []
  for (const file of checksums.keys()) {
    const platform = platformFromArchive(file)
    if (platform) platforms.push(platform)
    else if (!file.startsWith("redcode-whiteboard-")) throw new Error(`unexpected release asset in SHA256SUMS: ${file}`)
  }
  if (platforms.length === 0) throw new Error("SHA256SUMS lists no platform archives")

  const packages: string[] = []
  for (const item of platforms.toSorted((a, b) => a.key.localeCompare(b.key))) {
    const archive = path.join(input.assetsDir, item.archive)
    const digest = await sha256(archive)
    if (digest !== checksums.get(item.archive))
      throw new Error(`${item.archive} does not match SHA256SUMS (got ${digest})`)
    const expected = expectedBinaries(item)
    const actual = await members(archive)
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`${item.archive} must contain exactly ${expected.join(", ")}; found ${actual.join(", ")}`)

    const dir = path.join(input.distDir, item.key)
    const bin = path.join(dir, "bin")
    await rm(dir, { recursive: true, force: true })
    await mkdir(bin, { recursive: true })
    if (item.archive.endsWith(".zip")) await $`unzip -q -o ${archive} -d ${bin}`
    else await $`tar -xzf ${archive} -C ${bin}`
    const extracted = (await readdir(bin)).toSorted()
    if (JSON.stringify(extracted) !== JSON.stringify(expected))
      throw new Error(`${item.archive} unpacked to ${extracted.join(", ")}, expected ${expected.join(", ")}`)
    if (item.os !== "win32") await $`chmod 755 ${expected.map((name) => path.join(bin, name))}`
    await Bun.write(path.join(dir, "package.json"), JSON.stringify(platformManifest(item, input.version), null, 2))
    packages.push(`${npmScope}/${item.key}`)
  }
  return packages
}

if (import.meta.main) {
  const [assetsDir, distDir, version] = process.argv.slice(2)
  if (!assetsDir || !distDir || !version)
    throw new Error("usage: npm-release-assets.ts <assets-dir> <dist-dir> <version>")
  const packages = await unpackReleaseAssets({ assetsDir, distDir, version })
  console.log(`unpacked ${packages.length} platform packages from the release assets: ${packages.join(", ")}`)
}
