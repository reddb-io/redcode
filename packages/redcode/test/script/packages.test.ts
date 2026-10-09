import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { chmod, mkdtemp, rm, symlink } from "node:fs/promises"
import { RedcodePackages } from "../../script/packages"

const version = "9.8.7"
// zip packs the Windows archive; a machine without it covers the tar.gz targets only.
const targets = [
  { target: "linux-x64", os: "linux", cpu: "x64", desktop: "linux-x64" },
  { target: "linux-x64-baseline", os: "linux", cpu: "x64", desktop: "linux-x64" },
  { target: "linux-x64-baseline-musl", os: "linux", cpu: "x64", desktop: undefined },
  { target: "darwin-arm64", os: "darwin", cpu: "arm64", desktop: "darwin-arm64" },
  ...(Bun.which("zip") && Bun.which("unzip")
    ? [{ target: "windows-x64", os: "win32", cpu: "x64", desktop: "windows-x64" }]
    : []),
]
const desktops = [...new Set(targets.flatMap((item) => (item.desktop ? [item.desktop] : [])))]
// Windows needs a privilege to create symlinks; the other hosts check that archives keep them.
const links = process.platform !== "win32"

/** The unpacked desktop app of each target, as `REDCODE_DESKTOP_DIST/<os>-<arch>/` holds it. */
const desktopFiles: Record<string, string[]> = {
  "linux-x64": ["io.reddb.redcode", "chrome-sandbox", "resources/app.asar"],
  "darwin-arm64": ["Redcode.app/Contents/MacOS/Redcode", "Redcode.app/Contents/Resources/app.asar"],
  "windows-x64": ["Redcode.exe", "resources/app.asar"],
}

/**
 * A dist/ as `bun run build` leaves it, beside a design-app dist/ as its `build --release` leaves it and the unpacked
 * desktop apps CI normalizes.
 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-packages-"))
  const dist = path.join(root, "dist")
  const design = path.join(root, "design")
  const desktop = path.join(root, "desktop")
  await Promise.all(
    targets.map(async (item) => {
      const extension = item.target.startsWith("windows-") ? ".exe" : ""
      await Bun.write(
        path.join(dist, `redcode-${item.target}`, "package.json"),
        JSON.stringify({
          name: `@reddb-io/redcode-${item.target}`,
          version,
          license: "MIT",
          repository: { type: "git", url: "git+https://github.com/reddb-io/redcode.git" },
          os: [item.os],
          cpu: [item.cpu],
        }),
      )
      await Bun.write(path.join(dist, `redcode-${item.target}`, "bin", `redcode${extension}`), `redcode ${item.target}`)
      await Bun.write(
        path.join(dist, `redcode-${item.target}`, "bin", `redcode-rpc-sidecar${extension}`),
        `sidecar ${item.target}`,
      )
      await Bun.write(
        path.join(design, `redcode-design-${item.target}`, `redcode-design${extension}`),
        `design ${item.target}`,
      )
    }),
  )
  await Promise.all(
    desktops.map(async (target) => {
      await Promise.all(
        desktopFiles[target]!.map((file) => Bun.write(path.join(desktop, target, file), `${target} ${file}`)),
      )
      if (target === "linux-x64" && links) {
        await chmod(path.join(desktop, target, "io.reddb.redcode"), 0o755)
        await symlink("io.reddb.redcode", path.join(desktop, target, "redcode-desktop"))
      }
      if (target === "darwin-arm64" && links)
        await symlink("MacOS/Redcode", path.join(desktop, target, "Redcode.app/Contents/Current"))
    }),
  )
  await Bun.write(
    path.join(dist, "redcode-package", "package.json"),
    JSON.stringify({ name: "@reddb-io/redcode", version }),
  )
  await Bun.write(path.join(design, `redcode-whiteboard-${version}.tar.gz`), "whiteboard")
  return { root, dist, design, desktop, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

async function run(script: string, input: { dist: string; design: string; desktop: string }, ...args: string[]) {
  const child = Bun.spawn(
    [process.execPath, path.resolve(import.meta.dir, "../../script", script), `--dist=${input.dist}`, ...args],
    {
      env: {
        ...process.env,
        REDCODE_VERSION: version,
        REDCODE_DESIGN_DIST: input.design,
        REDCODE_DESKTOP_DIST: input.desktop,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`${script} exited with ${code}: ${stderr}`)
}

/** Lists an archive from its own directory: GNU tar on Windows reads `C:\...` as a remote host. */
async function list(directory: string, archive: string, verbose = false) {
  const command = archive.endsWith(".zip")
    ? ["unzip", "-Z1", archive]
    : ["tar", verbose ? "-tvf" : "-tf", archive, ...(archive.endsWith(".gz") ? ["-z"] : [])]
  const child = Bun.spawn(command, { cwd: directory, stdout: "pipe" })
  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
  if (code !== 0) throw new Error(`${command.join(" ")} exited with ${code}`)
  return stdout.split(/\r?\n/).filter(Boolean)
}

/** An archive's files and symlinks, without its directory entries. */
async function entries(directory: string, archive: string) {
  return (await list(directory, archive)).filter((entry) => !entry.endsWith("/")).toSorted()
}

/** The files and symlinks a desktop tree puts under `prefix`. */
function desktopEntries(target: string, prefix: string) {
  return [
    ...desktopFiles[target]!,
    ...(links && target === "linux-x64" ? ["redcode-desktop"] : []),
    ...(links && target === "darwin-arm64" ? ["Redcode.app/Contents/Current"] : []),
  ].map((file) => `${prefix}${file}`)
}

test("classifies CLI, design and desktop packages and leaves out the meta package", async () => {
  await using input = await fixture()
  await run("assemble.ts", input)
  const packages = await RedcodePackages.list(input.dist, version)
  expect(packages.map((item) => `${item.kind} ${item.target}`).toSorted()).toEqual(
    [
      ...targets.flatMap((item) => [`cli ${item.target}`, `design ${item.target}`]),
      ...desktops.map((target) => `desktop ${target}`),
    ].toSorted(),
  )
  expect(packages.find((item) => item.kind === "design")?.manifest.name).toStartWith("@reddb-io/redcode-design-")
  expect(RedcodePackages.binaries({ kind: "cli", target: "windows-arm64" })).toEqual([
    "redcode.exe",
    "redcode-rpc-sidecar.exe",
  ])
  expect(RedcodePackages.binaries({ kind: "design", target: "linux-arm64-musl" })).toEqual(["redcode-design"])
  expect(RedcodePackages.files({ kind: "desktop", target: "windows-arm64" })).toEqual(["desktop/desktop.tar"])
  expect(RedcodePackages.files({ kind: "cli", target: "linux-x64" })).toEqual(["bin/redcode", "bin/redcode-rpc-sidecar"])
  await expect(RedcodePackages.list(input.dist, "0.0.1")).rejects.toThrow("Unexpected platform package")
})

test.each([
  { target: "linux-x64", desktop: "linux-x64" },
  { target: "linux-x64-baseline", desktop: "linux-x64" },
  { target: "linux-arm64-musl", desktop: undefined },
  { target: "linux-x64-baseline-musl", desktop: undefined },
  { target: "darwin-x64-baseline", desktop: "darwin-x64" },
  { target: "windows-arm64", desktop: "windows-arm64" },
])("maps the CLI target $target to its desktop app", (input) => {
  expect(RedcodePackages.desktopTarget(input.target)).toBe(input.desktop)
})

test("assemble writes each target's design and desktop packages and names them from the CLI package", async () => {
  await using input = await fixture()
  await run("assemble.ts", input)
  for (const item of targets) {
    const extension = item.target.startsWith("windows-") ? ".exe" : ""
    const design = path.join(input.dist, `redcode-design-${item.target}`)
    expect(await Bun.file(path.join(design, "package.json")).json()).toEqual({
      name: `@reddb-io/redcode-design-${item.target}`,
      version,
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/reddb-io/redcode.git" },
      os: [item.os],
      cpu: [item.cpu],
    })
    expect(await Bun.file(path.join(design, "bin", `redcode-design${extension}`)).text()).toBe(`design ${item.target}`)
    expect(await Bun.file(path.join(design, "LICENSE")).exists()).toBe(true)
    expect(await Bun.file(path.join(design, "NOTICE")).exists()).toBe(true)
    expect(
      (await Bun.file(path.join(input.dist, `redcode-${item.target}`, "package.json")).json()).optionalDependencies,
    ).toEqual({
      [`@reddb-io/redcode-design-${item.target}`]: version,
      ...(item.desktop ? { [`@reddb-io/redcode-desktop-${item.desktop}`]: version } : {}),
    })
  }
  for (const target of desktops) {
    const item = targets.find((candidate) => candidate.desktop === target)!
    const desktop = path.join(input.dist, `redcode-desktop-${target}`)
    expect(await Bun.file(path.join(desktop, "package.json")).json()).toEqual({
      name: `@reddb-io/redcode-desktop-${target}`,
      version,
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/reddb-io/redcode.git" },
      os: [item.os],
      cpu: [item.cpu],
      ...(item.os === "linux" ? { libc: ["glibc"] } : {}),
    })
    expect(await Bun.file(path.join(desktop, "LICENSE")).exists()).toBe(true)
    expect(await Bun.file(path.join(desktop, "NOTICE")).exists()).toBe(true)
    // The tar holds the app at its root: the CLI extracts it as the app's folder.
    expect(await entries(path.join(desktop, "desktop"), "desktop.tar")).toEqual(desktopEntries(target, "").toSorted())
  }
})

test("assemble refuses a CLI target the design or desktop app was not built for", async () => {
  await using design = await fixture()
  await rm(path.join(design.design, `redcode-design-${targets[0]!.target}`), { recursive: true })
  await expect(run("assemble.ts", design)).rejects.toThrow(`Missing design app for ${targets[0]!.target}`)
  await using desktop = await fixture()
  await rm(path.join(desktop.desktop, "darwin-arm64"), { recursive: true })
  await expect(run("assemble.ts", desktop)).rejects.toThrow("Missing desktop app for darwin-arm64")
})

test("archive packs redcode, its sidecar, the design app and the desktop app per target, with the whiteboard bundle", async () => {
  await using input = await fixture()
  const release = path.join(input.root, "release")
  await run("assemble.ts", input)
  await run("archive.ts", input, `--outdir=${release}`)
  for (const item of targets) {
    const windows = item.target.startsWith("windows-")
    const archive = `redcode-${item.target}.${windows ? "zip" : "tar.gz"}`
    expect(await entries(release, archive)).toEqual(
      [
        ...(windows
          ? ["redcode-design.exe", "redcode-rpc-sidecar.exe", "redcode.exe"]
          : ["redcode", "redcode-design", "redcode-rpc-sidecar"]),
        ...(item.desktop ? desktopEntries(item.desktop, "desktop/") : []),
      ].toSorted(),
    )
    if (!links || item.desktop !== "linux-x64") continue
    // Archives keep the app's executable modes and symlinks.
    const verbose = await list(release, archive, true)
    expect(verbose.find((line) => line.endsWith(" desktop/io.reddb.redcode"))).toStartWith("-rwxr-xr-x")
    expect(verbose.find((line) => line.includes(" desktop/redcode-desktop "))).toEndWith("-> io.reddb.redcode")
  }
  const whiteboard = `redcode-whiteboard-${version}.tar.gz`
  expect(await Bun.file(path.join(release, whiteboard)).text()).toBe("whiteboard")
  const sums = (await Bun.file(path.join(release, "SHA256SUMS")).text()).trim().split("\n")
  expect(sums.map((line) => line.split(/\s+/)[1]).toSorted()).toEqual(
    [
      ...targets.map((item) => `redcode-${item.target}.${item.target.startsWith("windows-") ? "zip" : "tar.gz"}`),
      whiteboard,
    ].toSorted(),
  )
  const digest = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path.join(release, whiteboard)).bytes())
    .digest("hex")
  expect(sums).toContain(`${digest}  ${whiteboard}`)
})

test("archive refuses a CLI package without its design or desktop app", async () => {
  await using design = await fixture()
  await expect(run("archive.ts", design, `--outdir=${path.join(design.root, "release")}`)).rejects.toThrow(
    "Missing @reddb-io/redcode-design-",
  )
  await using desktop = await fixture()
  await run("assemble.ts", desktop)
  await rm(path.join(desktop.dist, "redcode-desktop-linux-x64"), { recursive: true })
  await expect(run("archive.ts", desktop, `--outdir=${path.join(desktop.root, "release")}`)).rejects.toThrow(
    "Missing @reddb-io/redcode-desktop-linux-x64",
  )
})
