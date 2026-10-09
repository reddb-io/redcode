import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// electron-builder's update info, as each build job writes it: one file entry per artifact, plus the legacy
// path/sha512 pair that electron-updater only reads when `files` is missing.
const feed = (version: string, files: { url: string; size: number; blockMapSize?: number }[]) =>
  [
    `version: ${version}`,
    "files:",
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.url}-sha==`,
      `    size: ${file.size}`,
      ...(file.blockMapSize ? [`    blockMapSize: ${file.blockMapSize}`] : []),
    ]),
    `path: ${files[0]?.url}`,
    `sha512: ${files[0]?.url}-sha==`,
    "releaseDate: '2026-10-09T12:00:00.000Z'",
    "",
  ].join("\n")

const entry = (url: string, size: number, blockMapSize?: number) => ({
  url,
  sha512: `${url}-sha==`,
  size,
  ...(blockMapSize ? { blockMapSize } : {}),
})

// The rolling desktop-latest release is the generic feed: electron-updater fetches latest.yml on Windows,
// latest-linux.yml on Linux and latest-mac.yml on macOS, where it picks the zip whose name matches its architecture.
test("merges the per-job feeds into the files electron-updater reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-latest-yml-"))
  const jobs = {
    "desktop-windows-x64/latest.yml": feed("0.2.0", [{ url: "redcode-desktop-win-x64.exe", size: 30, blockMapSize: 3 }]),
    "desktop-linux-x64/latest-linux.yml": feed("0.2.0", [{ url: "redcode-desktop-linux-x86_64.AppImage", size: 40 }]),
    "desktop-macos-arm64/latest-mac.yml": feed("0.2.0", [
      { url: "redcode-desktop-mac-arm64.zip", size: 10, blockMapSize: 1 },
      { url: "redcode-desktop-mac-arm64.dmg", size: 11 },
    ]),
    "desktop-macos-x64/latest-mac.yml": feed("0.2.0", [
      { url: "redcode-desktop-mac-x64.zip", size: 20, blockMapSize: 2 },
      { url: "redcode-desktop-mac-x64.dmg", size: 21 },
    ]),
  }

  try {
    await Promise.all(
      Object.entries(jobs).map(async ([file, content]) => {
        await mkdir(path.join(root, "artifacts", path.dirname(file)), { recursive: true })
        await Bun.write(path.join(root, "artifacts", file), content)
      }),
    )

    const run = Bun.spawnSync(["bun", path.join(import.meta.dirname, "finalize-latest-yml.ts"), path.join(root, "out")], {
      env: { ...process.env, LATEST_YML_DIR: path.join(root, "artifacts") },
    })
    expect(run.exitCode).toBe(0)

    const read = async (name: string) => Bun.YAML.parse(await Bun.file(path.join(root, "out", name)).text())

    expect((await readdir(path.join(root, "out"))).sort()).toEqual(["latest-linux.yml", "latest-mac.yml", "latest.yml"])
    expect(await read("latest.yml")).toEqual({
      version: "0.2.0",
      files: [entry("redcode-desktop-win-x64.exe", 30, 3)],
      releaseDate: "2026-10-09T12:00:00.000Z",
    })
    expect(await read("latest-linux.yml")).toEqual({
      version: "0.2.0",
      files: [entry("redcode-desktop-linux-x86_64.AppImage", 40)],
      releaseDate: "2026-10-09T12:00:00.000Z",
    })
    expect(await read("latest-mac.yml")).toEqual({
      version: "0.2.0",
      files: [
        entry("redcode-desktop-mac-arm64.zip", 10, 1),
        entry("redcode-desktop-mac-arm64.dmg", 11),
        entry("redcode-desktop-mac-x64.zip", 20, 2),
        entry("redcode-desktop-mac-x64.dmg", 21),
      ],
      releaseDate: "2026-10-09T12:00:00.000Z",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
