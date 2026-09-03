import path from "path"
import fs from "fs/promises"
import os from "os"

// Core's tests used the developer's real ~/.red/redcode: the same cache, the same lock
// directory. That is contention with every other suite and with a running redcode, and it
// leaves state behind on the machine that ran them. The cost is that npm work starts from a
// cold cache, which is why this package's tests get a longer timeout.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-core-test-"))
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["REDCODE_TEST_HOME"] = testHome
process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

process.env.REDCODE_DB = ":memory:"
process.env.REDCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.REDCODE_DISABLE_MODELS_FETCH = "true"
