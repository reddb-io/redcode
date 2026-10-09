import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { RedcodePackages } from "../../script/packages"

const version = "9.8.7"
// zip packs the Windows archive; a machine without it covers the tar.gz targets only.
const targets = [
  { target: "linux-x64-baseline-musl", os: "linux", cpu: "x64" },
  { target: "darwin-arm64", os: "darwin", cpu: "arm64" },
  ...(Bun.which("zip") && Bun.which("unzip") ? [{ target: "windows-x64", os: "win32", cpu: "x64" }] : []),
]

/** A dist/ as `bun run build` leaves it, beside a design-app dist/ as its `build --release` leaves it. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-packages-"))
  const dist = path.join(root, "dist")
  const design = path.join(root, "design")
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
  await Bun.write(
    path.join(dist, "redcode-package", "package.json"),
    JSON.stringify({ name: "@reddb-io/redcode", version }),
  )
  await Bun.write(path.join(design, `redcode-whiteboard-${version}.tar.gz`), "whiteboard")
  return { root, dist, design, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

async function run(script: string, input: { dist: string; design: string }, ...args: string[]) {
  const child = Bun.spawn(
    [process.execPath, path.resolve(import.meta.dir, "../../script", script), `--dist=${input.dist}`, ...args],
    {
      env: { ...process.env, REDCODE_VERSION: version, REDCODE_DESIGN_DIST: input.design },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`${script} exited with ${code}: ${stderr}`)
}

/** Lists an archive from its own directory: GNU tar on Windows reads `C:\...` as a remote host. */
async function entries(directory: string, archive: string) {
  const command = archive.endsWith(".zip") ? ["unzip", "-Z1", archive] : ["tar", "-tzf", archive]
  const child = Bun.spawn(command, { cwd: directory, stdout: "pipe" })
  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
  if (code !== 0) throw new Error(`${command.join(" ")} exited with ${code}`)
  return stdout.split(/\r?\n/).filter(Boolean).toSorted()
}

test("classifies CLI and design packages and leaves out the meta package", async () => {
  await using input = await fixture()
  await run("assemble.ts", input)
  const packages = await RedcodePackages.list(input.dist, version)
  expect(packages.map((item) => `${item.kind} ${item.target}`).toSorted()).toEqual(
    targets.flatMap((item) => [`cli ${item.target}`, `design ${item.target}`]).toSorted(),
  )
  expect(packages.find((item) => item.kind === "design")?.manifest.name).toStartWith("@reddb-io/redcode-design-")
  expect(RedcodePackages.binaries({ kind: "cli", target: "windows-arm64" })).toEqual([
    "redcode.exe",
    "redcode-rpc-sidecar.exe",
  ])
  expect(RedcodePackages.binaries({ kind: "design", target: "linux-arm64-musl" })).toEqual(["redcode-design"])
  await expect(RedcodePackages.list(input.dist, "0.0.1")).rejects.toThrow("Unexpected platform package")
})

test("assemble writes each target's design package and names it from the CLI package", async () => {
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
    ).toEqual({ [`@reddb-io/redcode-design-${item.target}`]: version })
  }
})

test("assemble refuses a CLI target the design app was not built for", async () => {
  await using input = await fixture()
  await rm(path.join(input.design, `redcode-design-${targets[0]!.target}`), { recursive: true })
  await expect(run("assemble.ts", input)).rejects.toThrow(`Missing design app for ${targets[0]!.target}`)
})

test("archive packs redcode, its sidecar and the design app per target, with the whiteboard bundle", async () => {
  await using input = await fixture()
  const release = path.join(input.root, "release")
  await run("assemble.ts", input)
  await run("archive.ts", input, `--outdir=${release}`)
  for (const item of targets) {
    const windows = item.target.startsWith("windows-")
    const archive = `redcode-${item.target}.${windows ? "zip" : "tar.gz"}`
    expect(await entries(release, archive)).toEqual(
      windows
        ? ["redcode-design.exe", "redcode-rpc-sidecar.exe", "redcode.exe"]
        : ["redcode", "redcode-design", "redcode-rpc-sidecar"],
    )
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

test("archive refuses a CLI package without its design app", async () => {
  await using input = await fixture()
  await expect(run("archive.ts", input, `--outdir=${path.join(input.root, "release")}`)).rejects.toThrow(
    "Missing @reddb-io/redcode-design-",
  )
})
