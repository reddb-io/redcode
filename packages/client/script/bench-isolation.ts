import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// This module must be imported before the server and client modules: Global resolves paths at import time.
const parent = fs.realpathSync(os.tmpdir())
const root = fs.mkdtempSync(path.join(parent, "redcode-transport-home-"))
const relative = path.relative(parent, root)
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe benchmark home")
process.env.REDCODE_TEST_HOME = path.join(root, "home")
process.env.XDG_CONFIG_HOME = path.join(root, "config")
process.env.XDG_DATA_HOME = path.join(root, "data")
process.env.XDG_CACHE_HOME = path.join(root, "cache")
process.env.XDG_STATE_HOME = path.join(root, "state")
delete process.env.OPENCODE_CONFIG
delete process.env.OPENCODE_CONFIG_CONTENT
delete process.env.OPENCODE_CONFIG_DIR

export const isolatedBenchmark = {
  [Symbol.dispose]() {
    fs.rmSync(root, { recursive: true, force: true })
  },
}
