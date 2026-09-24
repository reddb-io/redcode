#!/usr/bin/env bun

// Builds redcode-design, the design app, as one compiled binary for every platform redcode ships,
// named the way redcode's own build names its target (REDCODE_TARGET) so a redcode downloads the
// matching one. With --release it packs them with the whiteboard bundle, a manifest carrying the
// protocol, and SHA256SUMS; --upload adds them to the design-v<version> GitHub release.
//
// Usage: build.ts [--single] [--skip-install] [--release] [--upload]

import { $ } from "bun"
import path from "path"
import pkg from "../package.json"
import redcode from "../../redcode/package.json"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const single = process.argv.includes("--single")
const release = process.argv.includes("--release")
const upload = process.argv.includes("--upload")
const skipInstall = process.argv.includes("--skip-install")
const version = process.env.REDCODE_DESIGN_VERSION ?? pkg.version
if (release && version !== pkg.version)
  throw new Error(`release ${version} does not match packages/design-app/package.json ${pkg.version}`)
const { DesignApp } = await import("@reddb-io/redcode-core/design/app")
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
const targets = single ? all.filter(native) : all

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

await $`rm -rf dist`
// Every platform's native packages, as redcode's build installs them, so each cross-compiled binary
// links its own.
if (!skipInstall)
  for (const name of ["@opentui/core", "@parcel/watcher", "@ff-labs/fff-bun"] as const)
    await $`bun install --os="*" --cpu="*" ${name}@${redcode.dependencies[name]}`.cwd("../redcode")
const built: string[] = []
for (const item of targets) {
  const platform = [
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi,
  ]
    .filter(Boolean)
    .join("-")
  const name = `${product}-${platform}`
  const binary = `dist/${name}/${product}${item.os === "win32" ? ".exe" : ""}`
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
      REDCODE_VERSION: JSON.stringify(version),
      REDCODE_CHANNEL: JSON.stringify("latest"),
      REDCODE_DESIGN_WORKER_PATH: JSON.stringify(bunfsRoot + workerPath),
      REDCODE_DESIGN_RUNTIME: "true",
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      REDCODE_LIBC: item.os === "linux" ? JSON.stringify(item.abi ?? "glibc") : "undefined",
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
  built.push(name)
}

if (release) {
  const archives = await Promise.all(
    built.map(async (name) => {
      if (name.includes("-linux-")) {
        await $`tar -czf ../${name}.tar.gz *`.cwd(`dist/${name}`)
        return `dist/${name}.tar.gz`
      }
      await $`zip -r ../${name}.zip *`.cwd(`dist/${name}`)
      return `dist/${name}.zip`
    }),
  )
  // The whiteboard bundle rides on this release: only the design app serves whiteboards, and it
  // downloads the bundle of its own version the first time a diagram is opened as one.
  await $`bun ../redcode/script/whiteboard-bundle.ts --archive`.env({ ...process.env, REDCODE_VERSION: version })
  await $`cp ../redcode/dist/redcode-whiteboard-${version}.tar.gz dist/`
  // What redcode reads before it downloads anything: a release of another protocol is refused.
  await Bun.write("dist/manifest.json", `${JSON.stringify({ version, protocol: DesignApp.PROTOCOL })}\n`)
  const files = [...archives, `dist/redcode-whiteboard-${version}.tar.gz`, "dist/manifest.json"].sort()
  const sums = await Promise.all(
    files.map(
      async (file) =>
        `${new Bun.CryptoHasher("sha256").update(await Bun.file(file).bytes()).digest("hex")}  ${path.basename(file)}`,
    ),
  )
  await Bun.write("dist/SHA256SUMS", `${sums.join("\n")}\n`)
  if (upload)
    await $`gh release upload design-v${version} ${files} dist/SHA256SUMS --clobber --repo ${process.env.GH_REPO}`
}
