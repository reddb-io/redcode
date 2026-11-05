import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { binaryPath } from "@opencode-ai/pty"

test("extracts the embedded persistent terminal executable with the platform filename", async () => {
  if (!binaryPath) throw new Error("The persistent terminal executable is unavailable for this platform")
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-pty-extract-"))
  const previous = process.env.OPENCODE_PTY_BIN
  delete process.env.OPENCODE_PTY_BIN
  try {
    const bytes = await readFile(binaryPath)
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const result = await Bun.build({
      entrypoints: [path.resolve(import.meta.dir, "../src/persistent-pty/binary.bun.ts")],
      outdir: root,
      target: "bun",
      plugins: [
        {
          name: "embedded-pty-test",
          setup(build) {
            build.onResolve({ filter: /pty-binding\.js$/ }, () => ({ path: "binding", namespace: "embedded-pty-test" }))
            build.onLoad({ filter: /.*/, namespace: "embedded-pty-test" }, () => ({
              loader: "js",
              contents: `export default ${JSON.stringify({ path: binaryPath, version: "0.3.1", sha256 })}`,
            }))
          },
        },
      ],
    })
    expect(result.success).toBe(true)
    const { resolveBinary } = await import(pathToFileURL(result.outputs[0]!.path).href)
    const executable = await resolveBinary(path.join(root, "bin"))
    expect(path.basename(executable)).toBe(process.platform === "win32" ? "opencode-pty.exe" : "opencode-pty")
    expect(
      createHash("sha256")
        .update(await readFile(executable))
        .digest("hex"),
    ).toBe(sha256)
    expect(await resolveBinary(path.join(root, "bin"))).toBe(executable)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_PTY_BIN
    else process.env.OPENCODE_PTY_BIN = previous
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
