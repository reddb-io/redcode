import { expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

// The TUI registers the Solid transform for plugin files at startup. Babel behind it is megabytes of
// heap on the TUI thread, so the patched plugin loads it on the first file it transforms instead.
test("registering the Solid transform plugin does not load Babel", async () => {
  const plugin = Bun.resolveSync("@opentui/solid/bun-plugin", import.meta.dir)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-solid-transform-"))
  const script = path.join(dir, "probe.ts")
  await Bun.write(
    script,
    [
      `const { ensureSolidTransformPlugin } = await import(${JSON.stringify(plugin)})`,
      `ensureSolidTransformPlugin({ moduleName: "@opentui/solid" })`,
      `console.log(JSON.stringify(Object.keys(require.cache).filter((key) => key.includes("@babel"))))`,
    ].join("\n"),
  )
  // Run outside the package so its bunfig preload (which registers the same plugin) does not apply.
  const child = Bun.spawn([process.execPath, script], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  await fs.rm(dir, { recursive: true, force: true })
  expect(stderr).toBe("")
  expect(code).toBe(0)
  expect(JSON.parse(stdout.trim())).toEqual([])
})
