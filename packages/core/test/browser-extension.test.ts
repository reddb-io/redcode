import { describe, expect } from "bun:test"
import path from "node:path"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { BrowserExtension } from "../src/browser-extension"
import { testEffect } from "./lib/effect"
import { tmpdirScoped } from "./fixture/tmpdir"

const it = testEffect(LayerNode.compile(AppProcess.node))

describe.skipIf(process.platform !== "linux" || !(Bun.which("google-chrome") ?? Bun.which("google-chrome-stable")))("Chrome extension packaging", () => {
  it.live("reuses its signing identity, generates valid CRX3 and never registers without administrator installation", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("redcode-chrome-test-")
      const root = path.join(tmp.path, "owned ' installer")
      const extensionDirectory = path.join(tmp.path, "extension")
      yield* Effect.promise(async () => {
        await mkdir(extensionDirectory)
        await writeFile(path.join(extensionDirectory, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Redcode fixture", version: "1.0.0" }))
      })
      const first = yield* BrowserExtension.prepare({ root, extensionDirectory })
      expect(first.state).toBe("administrator-required")
      expect(first.command).toContain("'\\''")
      const key = yield* Effect.promise(() => readFile(path.join(root, "signing-key.pem"), "utf8"))
      const crx = yield* Effect.promise(() => readFile(path.join(root, "extension.crx")))
      // Chrome writes the independently signed extension ID into CRX3's signed header.
      const id = Buffer.from(first.extensionID!.replace(/[a-p]/g, (digit) => (digit.charCodeAt(0) - 97).toString(16)), "hex")
      expect(crx.indexOf(id, 12)).toBeGreaterThan(11)
      expect((yield* Effect.promise(() => stat(path.join(root, "signing-key.pem")))).mode & 0o777).toBe(0o600)
      yield* Effect.promise(() => writeFile(path.join(extensionDirectory, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Redcode fixture", version: "1.0.1" })))
      const second = yield* BrowserExtension.prepare({ root, extensionDirectory })
      expect(second.extensionID).toBe(first.extensionID)
      expect(second.version).toBe("1.0.1")
      expect(second.state).toBe("administrator-required")
      expect(yield* Effect.promise(() => readFile(path.join(root, "signing-key.pem"), "utf8"))).toBe(key)
      const processes = yield* AppProcess.Service
      yield* processes.run(ChildProcess.make("/bin/sh", ["-n", path.join(root, "install.sh")])).pipe(Effect.flatMap(AppProcess.requireSuccess))
      expect((yield* BrowserExtension.inspect(root)).state).toBe("administrator-required")
    }), 60_000,
  )
})
