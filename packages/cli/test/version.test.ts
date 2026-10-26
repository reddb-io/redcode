import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("version exits without initializing configuration, storage or logging", async () => {
  await using directory = {
    path: await mkdtemp(path.join(os.tmpdir(), "redcode-version-")),
    async [Symbol.asyncDispose]() {
      await rm(this.path, { recursive: true, force: true })
    },
  }
  await Bun.write(path.join(directory.path, "unavailable"), "A file, not a writable configuration directory")
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:OPENCODE_|REDCODE_|OTEL_)/.test(key))),
    REDCODE_TEST_HOME: directory.path,
    OPENCODE_TEST_HOME: directory.path,
    XDG_DATA_HOME: path.join(directory.path, "data"),
    XDG_CACHE_HOME: path.join(directory.path, "cache"),
    XDG_CONFIG_HOME: path.join(directory.path, "config"),
    XDG_STATE_HOME: path.join(directory.path, "state"),
    // Full CLI startup rejects this location; a version query must never touch it.
    OPENCODE_CONFIG_DIR: path.join(directory.path, "unavailable"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  }
  for (const entry of ["index.ts", "redcode.ts"]) {
    const command = entry === "redcode.ts" ? "redcode" : "opencode"
    for (const flag of ["--version", "-v"]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "--define",
          `OPENCODE_CLI_NAME=${JSON.stringify(command)}`,
          "--define",
          'OPENCODE_VERSION="0.0.0-version-test"',
          path.join(import.meta.dir, "../src", entry),
          flag,
        ],
        { cwd: directory.path, env: environment, stdout: "pipe", stderr: "pipe" },
      )
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: `${command} v0.0.0-version-test\n`, stderr: "" })
      expect(await readdir(directory.path)).toEqual(["unavailable"])
    }
  }
})
