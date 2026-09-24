// Before any import of core: `global.ts` resolves the app home at module scope. Every design app this
// suite starts inherits these variables, so it opens the same home and database file as the test.
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { removeOnExit, sharePlaywrightBrowsers } from "../../core/test/fixture/temp-root"

// Before HOME and XDG_CACHE_HOME are repointed below, or every run downloads its own Chromium.
sharePlaywrightBrowsers()

const dir = path.join(os.tmpdir(), "redcode-design-app-test-" + process.pid)
removeOnExit(dir)
const home = path.join(dir, "home")
await fs.mkdir(home, { recursive: true })

process.env.REDCODE_TEST_HOME = home
process.env.HOME = home
process.env.XDG_DATA_HOME = path.join(dir, "share")
process.env.XDG_CACHE_HOME = path.join(dir, "cache")
process.env.XDG_CONFIG_HOME = path.join(dir, "config")
process.env.XDG_STATE_HOME = path.join(dir, "state")
// A file, not memory: the design app is another process and must see the rows this suite writes.
process.env.REDCODE_DB = path.join(dir, "redcode.db")
process.env.REDCODE_DISABLE_MODELS_FETCH = "true"
process.env.NPM_CONFIG_AUDIT = "false"
process.env.REDCODE_DESIGN_NO_OPEN = "1"
process.env.REDCODE_NO_BROWSER = "1"
delete process.env.REDCODE_SERVER_PASSWORD
delete process.env.REDCODE_DESIGN_BIN
