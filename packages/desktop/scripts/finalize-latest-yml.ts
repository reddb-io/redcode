#!/usr/bin/env bun
// Merges the electron-updater feeds that each desktop build job writes. Both macOS jobs emit latest-mac.yml, so
// uploading them side by side would let one architecture overwrite the other.
//   LATEST_YML_DIR=<downloaded artifacts> bun scripts/finalize-latest-yml.ts <output dir>

import path from "path"

const dir = process.env.LATEST_YML_DIR

if (!dir) throw new Error("LATEST_YML_DIR is required")

const out = process.argv[2]

if (!out) throw new Error("Usage: finalize-latest-yml.ts <output dir>")

type FileEntry = {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

type LatestYml = {
  version: string
  files: FileEntry[]
  releaseDate: string
}

function parse(content: string): LatestYml {
  const lines = content.split("\n")
  let version = ""
  let releaseDate = ""
  const files: FileEntry[] = []
  let current: Partial<FileEntry> | undefined

  const flush = () => {
    if (current?.url && current.sha512 && current.size) files.push(current as FileEntry)
    current = undefined
  }

  for (const line of lines) {
    const indented = line.startsWith("    ") || line.startsWith("  -")

    if (line.startsWith("version:")) version = line.slice("version:".length).trim()
    else if (line.startsWith("releaseDate:"))
      releaseDate = line.slice("releaseDate:".length).trim().replace(/^'|'$/g, "")
    else if (line.trim().startsWith("- url:")) {
      flush()
      current = { url: line.trim().slice("- url:".length).trim() }
    } else if (indented && current && line.trim().startsWith("sha512:"))
      current.sha512 = line.trim().slice("sha512:".length).trim()
    else if (indented && current && line.trim().startsWith("size:"))
      current.size = Number(line.trim().slice("size:".length).trim())
    else if (indented && current && line.trim().startsWith("blockMapSize:"))
      current.blockMapSize = Number(line.trim().slice("blockMapSize:".length).trim())
    else if (!indented && current) flush()
  }

  flush()

  return { version, files, releaseDate }
}

function serialize(data: LatestYml) {
  const lines = [`version: ${data.version}`, "files:"]

  for (const file of data.files) {
    lines.push(`  - url: ${file.url}`)
    lines.push(`    sha512: ${file.sha512}`)
    lines.push(`    size: ${file.size}`)

    if (file.blockMapSize) lines.push(`    blockMapSize: ${file.blockMapSize}`)
  }

  lines.push(`releaseDate: '${data.releaseDate}'`)

  return lines.join("\n") + "\n"
}

async function read(subdir: string, filename: string): Promise<LatestYml | undefined> {
  const file = Bun.file(path.join(dir, subdir, filename))

  if (!(await file.exists())) return undefined

  return parse(await file.text())
}

const output: Record<string, string> = {}

const windows = await read("desktop-windows-x64", "latest.yml")

if (windows) output["latest.yml"] = serialize(windows)

const linux = await read("desktop-linux-x64", "latest-linux.yml")

if (linux) output["latest-linux.yml"] = serialize(linux)

// macOS: merge arm64 + x64 into single file
const macX64 = await read("desktop-macos-x64", "latest-mac.yml")

const macArm64 = await read("desktop-macos-arm64", "latest-mac.yml")

if (macX64 || macArm64) {
  const base = macArm64 ?? macX64!
  output["latest-mac.yml"] = serialize({
    version: base.version,
    files: [...(macArm64?.files ?? []), ...(macX64?.files ?? [])],
    releaseDate: base.releaseDate,
  })
}

for (const [filename, content] of Object.entries(output)) {
  await Bun.write(path.join(out, filename), content)
  console.log(`wrote ${filename}`)
}
