import path from "node:path"
import { createHash } from "node:crypto"

/** Copy a staged, hash-verified native library and its license into a CLI artifact. */
export async function stagePathSearch(root: string, target: string, destination: string, sourceRoot = path.resolve(import.meta.dir, "../../core/script/native-path-search")) {
  const canonical = target.replace("-baseline", "")
  const source = path.join(root, canonical)
  const manifest = await Bun.file(path.join(source, "manifest.json")).json() as {
    target: string
    abiVersion: number
    filename: string
    sha256: string
    runtimeSmoke: boolean
    sourceSha256: string
    dependencies: Array<{ licenseFile: string; licenseSha256: string }>
    notices: { filename: string; sha256: string }
  }
  const expected = canonical.startsWith("windows-") ? "redcode_path_search.dll" : canonical.startsWith("darwin-") ? "libredcode_path_search.dylib" : "libredcode_path_search.so"
  if (manifest.target !== canonical || manifest.abiVersion !== 1 || manifest.filename !== expected || !manifest.runtimeSmoke)
    throw new Error(`Invalid path-search manifest for ${canonical}`)
  const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  const sourceFiles = ["Cargo.toml", "Cargo.lock", "src/lib.rs"]
  // Match the manifest's line-ending normalization: the artifact is built on one host and verified on
  // another, and a Windows checkout is CRLF while Linux is LF.
  const sourceHash = digest(
    (
      await Promise.all(
        sourceFiles.map(async (file) => {
          const bytes = await Bun.file(path.join(sourceRoot, file)).bytes()
          return `${file}\0${digest(new TextDecoder().decode(bytes).replace(/\r\n/g, "\n"))}`
        }),
      )
    ).join("\n"),
  )
  if (sourceHash !== manifest.sourceSha256) throw new Error(`Path-search source hash mismatch for ${canonical}`)
  const contract = await Bun.file(path.join(source, "contract-smoke.json")).json() as {
    passed: boolean
    library: { sha256: string }
  }
  if (!contract.passed || contract.library?.sha256 !== manifest.sha256)
    throw new Error(`Path-search contract smoke missing or mismatched for ${canonical}`)
  const license = manifest.dependencies.find((entry) => entry.licenseFile === "LICENSE.nucleo-matcher.txt")
  if (!license || manifest.notices?.filename !== "THIRD_PARTY_NOTICES.txt") throw new Error("Missing path-search license metadata")
  for (const [name, hash] of [[expected, manifest.sha256], [license.licenseFile, license.licenseSha256], [manifest.notices.filename, manifest.notices.sha256]] as const) {
    const bytes = await Bun.file(path.join(source, name)).bytes()
    if (digest(bytes) !== hash) throw new Error(`Path-search hash mismatch: ${name}`)
    await Bun.write(path.join(destination, name), bytes)
  }
}
