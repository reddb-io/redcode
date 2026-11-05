import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { collectNodeAssets } from "../script/node-assets"
import { nodeTarget, shellParserWasmAssets } from "../src/node/target"

test("collects each SEA asset key once", async () => {
  const assets = await collectNodeAssets(nodeTarget(process.platform, process.arch))
  const keys = assets.map((asset) => asset.key)

  expect(new Set(keys).size).toBe(keys.length)
  const executable = process.platform === "win32" ? "opencode-pty/opencode-pty.exe" : "opencode-pty/opencode-pty"
  expect(keys.filter((key) => key === executable)).toHaveLength(1)
  expect(assets.filter((asset) => asset.key === shellParserWasmAssets.runtime)).toEqual([
    {
      key: shellParserWasmAssets.runtime,
      source: fileURLToPath(import.meta.resolve(shellParserWasmAssets.runtime)),
    },
  ])
})

test("includes the persistent terminal daemon for both Windows architectures", () => {
  expect(nodeTarget("win32", "x64").opencodePtyAsset).toBe("opencode-pty/opencode-pty.exe")
  expect(nodeTarget("win32", "arm64").opencodePtyAsset).toBe("opencode-pty/opencode-pty.exe")
})
