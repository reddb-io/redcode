/** Build one experimental native package. This does not modify RedCode release output. */
import path from "node:path"
import { copyFile, mkdir, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dlopen, FFIType } from "bun:ffi"

const args = process.argv.slice(2)
const option = (key: string, fallback = "") => {
  const index = args.indexOf(`--${key}`)
  return index < 0 ? fallback : (args[index + 1] ?? fallback)
}

const targets = {
  "linux-arm64": { rust: "aarch64-unknown-linux-gnu", platform: "linux", arch: "arm64", libc: "glibc" },
  "linux-x64": { rust: "x86_64-unknown-linux-gnu", platform: "linux", arch: "x64", libc: "glibc" },
  "linux-x64-baseline": { rust: "x86_64-unknown-linux-gnu", platform: "linux", arch: "x64", libc: "glibc" },
  "linux-arm64-musl": { rust: "aarch64-unknown-linux-musl", platform: "linux", arch: "arm64", libc: "musl" },
  "linux-x64-musl": { rust: "x86_64-unknown-linux-musl", platform: "linux", arch: "x64", libc: "musl" },
  "linux-x64-baseline-musl": {
    rust: "x86_64-unknown-linux-musl",
    platform: "linux",
    arch: "x64",
    libc: "musl",
  },
  "darwin-arm64": { rust: "aarch64-apple-darwin", platform: "darwin", arch: "arm64" },
  "darwin-x64": { rust: "x86_64-apple-darwin", platform: "darwin", arch: "x64" },
  "darwin-x64-baseline": { rust: "x86_64-apple-darwin", platform: "darwin", arch: "x64" },
  "windows-arm64": { rust: "aarch64-pc-windows-msvc", platform: "win32", arch: "arm64" },
  "windows-x64": { rust: "x86_64-pc-windows-msvc", platform: "win32", arch: "x64" },
  "windows-x64-baseline": { rust: "x86_64-pc-windows-msvc", platform: "win32", arch: "x64" },
} as const

const name = option("target") as keyof typeof targets
const target = targets[name]
if (!target) throw new Error(`--target must be one of: ${Object.keys(targets).join(", ")}`)
const root = import.meta.dir
const out = path.resolve(option("out", path.join(root, "native-packages")))
const cargoTarget = path.resolve(option("cargo-target", path.join(out, ".cargo-target")))
const destinationDirectory = path.join(out, name)
const rustFlags = [
  process.env.RUSTFLAGS,
  target.platform === "linux" && target.libc === "musl" ? "-C target-feature=-crt-static" : undefined,
  target.platform === "win32" ? "-C link-arg=/Brepro" : undefined,
].filter(Boolean).join(" ")

const build = Bun.spawn(
  [
    "cargo",
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    path.join(root, "Cargo.toml"),
    "--target",
    target.rust,
    "--target-dir",
    cargoTarget,
  ],
  {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      ...(rustFlags ? { RUSTFLAGS: rustFlags } : {}),
    },
  },
)
if ((await build.exited) !== 0) throw new Error(`cargo failed for ${name}`)

const cargoFilename =
  target.platform === "win32"
    ? "redcode_path_search_poc.dll"
    : target.platform === "darwin"
      ? "libredcode_path_search_poc.dylib"
      : "libredcode_path_search_poc.so"
const filename =
  target.platform === "win32"
    ? "redcode_path_search.dll"
    : target.platform === "darwin"
      ? "libredcode_path_search.dylib"
      : "libredcode_path_search.so"
const source = path.join(cargoTarget, target.rust, "release", cargoFilename)
if (!(await Bun.file(source).exists())) throw new Error(`cargo did not produce ${source}`)
const relativeDestination = path.relative(out, destinationDirectory)
if (!relativeDestination || relativeDestination.startsWith("..") || path.isAbsolute(relativeDestination))
  throw new Error(`invalid package destination: ${destinationDirectory}`)
await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })
const destination = path.join(destinationDirectory, filename)
await Bun.write(destination, Bun.file(source))

const metadataResult = Bun.spawnSync([
  "cargo",
  "metadata",
  "--format-version",
  "1",
  "--locked",
  "--manifest-path",
  path.join(root, "Cargo.toml"),
])
if (metadataResult.exitCode !== 0) throw new Error(metadataResult.stderr.toString())
const metadata = JSON.parse(metadataResult.stdout.toString()) as {
  packages: Array<{ name: string; version: string; license?: string; manifest_path: string; repository?: string }>
}
const nucleo = metadata.packages.find((item) => item.name === "nucleo-matcher" && item.version === "0.3.1")
if (!nucleo || nucleo.license !== "MPL-2.0") throw new Error("locked nucleo-matcher 0.3.1 MPL-2.0 metadata missing")
const licenseSource = path.join(path.dirname(nucleo.manifest_path), "LICENSE")
if (!(await Bun.file(licenseSource).exists())) throw new Error(`nucleo-matcher license missing: ${licenseSource}`)
const licenseFilename = "LICENSE.nucleo-matcher.txt"
const noticeFilename = "THIRD_PARTY_NOTICES.txt"
await copyFile(licenseSource, path.join(destinationDirectory, licenseFilename))
await Bun.write(
  path.join(destinationDirectory, noticeFilename),
  [
    "RedCode native path search — third-party notices",
    "",
    "nucleo-matcher 0.3.1",
    "License: Mozilla Public License 2.0 (MPL-2.0)",
    `Upstream: ${nucleo.repository ?? "https://github.com/helix-editor/nucleo"}`,
    "Source: https://crates.io/crates/nucleo-matcher/0.3.1",
    `License text: ${licenseFilename}`,
    "",
  ].join("\n"),
)

const bytes = await Bun.file(destination).bytes()
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const sourceFiles = ["Cargo.toml", "Cargo.lock", "src/lib.rs"]
// The manifest is produced on the target host and verified on another one: a Windows checkout has
// CRLF while Linux has LF, so hashing raw bytes made every cross-host verification fail. Normalize
// line endings so the digest describes the source, not the checkout's autocrlf.
const sourceSha256 = sha256(
  (
    await Promise.all(
      sourceFiles.map(async (file) => {
        const bytes = await Bun.file(path.join(root, file)).bytes()
        return `${file}\0${sha256(new TextDecoder().decode(bytes).replace(/\r\n/g, "\n"))}`
      }),
    )
  ).join("\n"),
)
const licenseBytes = await Bun.file(path.join(destinationDirectory, licenseFilename)).bytes()
const noticeBytes = await Bun.file(path.join(destinationDirectory, noticeFilename)).bytes()
const hostCompatible = target.platform === process.platform && target.arch === process.arch
let runtimeSmoke = false
if (hostCompatible) {
  const library = dlopen(destination, {
    redcode_search_abi_version: { args: [], returns: FFIType.u32 },
  })
  try {
    if (library.symbols.redcode_search_abi_version() !== 1) throw new Error("packaged library has the wrong ABI")
    runtimeSmoke = true
  } finally {
    library.close()
  }
}
const rustc = Bun.spawnSync(["rustc", "-vV"])
if (rustc.exitCode !== 0) throw new Error(rustc.stderr.toString())
const manifest = {
  formatVersion: 1,
  abiVersion: 1,
  target: name,
  rustTarget: target.rust,
  platform: target.platform,
  arch: target.arch,
  ...(target.platform === "linux" ? { libc: target.libc } : {}),
  filename,
  bytes: bytes.length,
  sha256: sha256(bytes),
  sourceSha256,
  sourceFiles,
  rustc: rustc.stdout.toString().trim(),
  runtimeSmoke,
  dependencies: [
    {
      name: "nucleo-matcher",
      version: "0.3.1",
      license: "MPL-2.0",
      repository: nucleo.repository,
      source: "https://crates.io/crates/nucleo-matcher/0.3.1",
      licenseFile: licenseFilename,
      licenseSha256: sha256(licenseBytes),
    },
  ],
  notices: { filename: noticeFilename, bytes: noticeBytes.length, sha256: sha256(noticeBytes) },
}
await Bun.write(path.join(destinationDirectory, "manifest.json"), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ directory: destinationDirectory, manifest }, null, 2))
