import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { stagePathSearch } from "./path-search-package"

test("stages a verified package for baseline and rejects altered binaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-path-package-"))
  const source = path.join(root, "windows-x64")
  const destination = path.join(root, "output")
  const sources = path.join(root, "sources")
  await mkdir(source)
  await mkdir(destination)
  await mkdir(path.join(sources, "src"), { recursive: true })
  const hash = (value: string) => createHash("sha256").update(value).digest("hex")
  const sourceFiles = ["Cargo.toml", "Cargo.lock", "src/lib.rs"]
  for (const file of sourceFiles) await Bun.write(path.join(sources, file), file)
  const sourceSha256 = hash(sourceFiles.map((file) => `${file}\0${hash(file)}`).join("\n"))
  const files = { "redcode_path_search.dll": "library", "LICENSE.nucleo-matcher.txt": "license", "THIRD_PARTY_NOTICES.txt": "notice" }
  for (const [name, content] of Object.entries(files)) await Bun.write(path.join(source, name), content)
  await Bun.write(path.join(source, "manifest.json"), JSON.stringify({
    target: "windows-x64", abiVersion: 1, filename: "redcode_path_search.dll", sha256: hash("library"), runtimeSmoke: true, sourceSha256,
    dependencies: [{ licenseFile: "LICENSE.nucleo-matcher.txt", licenseSha256: hash("license") }],
    notices: { filename: "THIRD_PARTY_NOTICES.txt", sha256: hash("notice") },
  }))
  await Bun.write(path.join(source, "contract-smoke.json"), JSON.stringify({ passed: true, library: { sha256: hash("library") } }))
  await stagePathSearch(root, "windows-x64-baseline", destination, sources)
  expect(await Bun.file(path.join(destination, "redcode_path_search.dll")).text()).toBe("library")
  await Bun.write(path.join(sources, "src/lib.rs"), "modified")
  await expect(stagePathSearch(root, "windows-x64", destination, sources)).rejects.toThrow("source hash mismatch")
  await Bun.write(path.join(sources, "src/lib.rs"), "src/lib.rs")
  await Bun.write(path.join(source, "redcode_path_search.dll"), "altered")
  await expect(stagePathSearch(root, "windows-x64", destination, sources)).rejects.toThrow("hash mismatch")
})
