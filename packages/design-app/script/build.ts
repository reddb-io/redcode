#!/usr/bin/env bun

// Builds redcode-design, the design app, as one compiled binary for every platform redcode ships, into
// dist/redcode-design-<target>/, named the way redcode's own build names its target (REDCODE_TARGET).
// packages/redcode's assemble step places each one beside the redcode of the same target, so the app
// ships in redcode's own vX.Y.Z release and npm packages. With --release it also builds the whiteboard
// bundle that release carries, dist/redcode-whiteboard-<version>.tar.gz.
//
// Usage: build.ts [--single] [--skip-install] [--release]

import { $ } from "bun"
import path from "path"
import { rm } from "node:fs/promises"
import redcode from "../../redcode/package.json"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const single = process.argv.includes("--single")
const release = process.argv.includes("--release")
const skipInstall = process.argv.includes("--skip-install")
const requestedTarget = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
const outdir = path.resolve(
  dir,
  process.argv.find((arg) => arg.startsWith("--outdir="))?.slice("--outdir=".length) ?? "dist",
)
if (outdir === dir || outdir === path.parse(outdir).root) throw new Error("Invalid Design build output directory")
const version = process.env.REDCODE_DESIGN_APP_VERSION ?? process.env.REDCODE_VERSION ?? redcode.version
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid design app version: ${version}`)
const { DesignApp } = await import("@opencode/core/design/app")
const product = "redcode-design"

const all: { os: "linux" | "darwin" | "win32"; arch: "arm64" | "x64"; abi?: "musl"; avx2?: false }[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "arm64" },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
]
const native = (item: (typeof all)[number]) =>
  item.os === process.platform && item.arch === process.arch && !item.abi && item.avx2 === undefined
const targetName = (item: (typeof all)[number]) =>
  [item.os === "win32" ? "windows" : item.os, item.arch, item.avx2 === false ? "baseline" : undefined, item.abi]
    .filter(Boolean)
    .join("-")
const targets = requestedTarget
  ? all.filter((item) => `${product}-${targetName(item)}` === requestedTarget)
  : single
    ? all.filter(native)
    : all
if (!targets.length) throw new Error("No native Design app target for this platform")

// The raster worker runs in its own thread, so it is bundled apart and embedded beside the app.
const worker = await Bun.build({
  entrypoints: ["../core/src/design/raster-worker.ts"],
  target: "bun",
  format: "esm",
  minify: true,
})
if (!worker.success) throw new AggregateError(worker.logs, "Unable to bundle the Design raster worker")
const workerSource = await worker.outputs[0].text()
const workerPath = "design-raster-worker.js"

await rm(outdir, { recursive: true, force: true })
// Resolve native packages for all release targets from the workspace lockfile.
if (!skipInstall) await $`bun install --frozen-lockfile --os="*" --cpu="*"`.cwd("../..")
for (const item of targets) {
  const platform = targetName(item)
  const name = `${product}-${platform}`
  const binary = path.join(outdir, name, `${product}${item.os === "win32" ? ".exe" : ""}`)
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  console.log(`building ${name}`)
  const result = await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: `bun-${platform}` as Bun.Build.CompileTarget,
      outfile: binary,
      execArgv: [`--user-agent=${product}/${version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: { [workerPath]: workerSource },
    entrypoints: ["./src/index.ts", workerPath],
    define: {
      REDCODE_DESIGN_APP_VERSION: JSON.stringify(version),
      REDCODE_TARGET: JSON.stringify(platform),
      REDCODE_DESIGN_WORKER_PATH: JSON.stringify(bunfsRoot + workerPath),
      REDCODE_DESIGN_RUNTIME: "true",
      REDCODE_DESIGN_PROCESS_HOST: "false",
      FFF_LIBC: item.os === "linux" ? JSON.stringify(item.abi ?? "gnu") : "undefined",
      OPENCODE_LIBC: item.os === "linux" ? JSON.stringify(item.abi ?? "glibc") : "undefined",
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })
  if (!result.success) throw new AggregateError(result.logs, `Unable to build ${name}`)
  if (native(item)) {
    const reported = (await $`${binary} --version`.text()).trim()
    if (reported !== version) throw new Error(`smoke test: ${binary} --version printed ${reported}, not ${version}`)
    const protocol = (await $`${binary} --protocol`.text()).trim()
    if (protocol !== String(DesignApp.PROTOCOL))
      throw new Error(`smoke test: ${binary} --protocol printed ${protocol}, not ${DesignApp.PROTOCOL}`)
    console.log(`smoke test passed: ${name} ${reported}, protocol ${protocol}`)
  }
}

// The whiteboard bundle rides on the release: only the design app serves whiteboards, and it downloads
// the bundle of its own version the first time a diagram is opened as one.
if (release) {
  await $`bun ../cli/script/whiteboard-bundle.ts --archive`.env({ ...process.env, REDCODE_VERSION: version })
  await $`cp ../cli/dist/redcode-whiteboard-${version}.tar.gz ${outdir}/`
}
