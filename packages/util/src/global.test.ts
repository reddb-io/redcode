import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("loading Redcode paths preserves the historical home directory and its contents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-global-"))
  try {
    const source = path.join(root, ".red", "redcode", "config.json")
    await Bun.write(source, '{"snapshot":false}')
    const child = Bun.spawn(
      [
        process.execPath,
        "--define",
        'OPENCODE_ARTIFACT="redcode"',
        "-e",
        `const { Global } = await import(${JSON.stringify(path.join(import.meta.dir, "global.ts"))}); process.stdout.write(JSON.stringify(Global.Path.config))`,
      ],
      {
        env: { ...process.env, REDCODE_TEST_HOME: root, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" })
    expect(JSON.parse(stdout)).toBe(path.join(root, ".red", "code"))
    expect(await Bun.file(source).text()).toBe('{"snapshot":false}')
    expect(await Bun.file(path.join(root, ".red", "code", "config.json")).exists()).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
