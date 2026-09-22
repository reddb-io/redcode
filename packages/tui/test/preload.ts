// IMPORTANT: these run before any import from src/, because core's `global.ts` resolves the app
// home at module scope. Without REDCODE_TEST_HOME a TUI test writes KV state, logs and databases
// into the developer's — or the runner's — real `~/.red/code`, and concurrent test processes share
// (and lock) the same files.
import os from "os"
import path from "path"
import fs from "fs/promises"
import { afterAll } from "bun:test"
import { removeOnExit, removeTempPaths, sharePlaywrightBrowsers } from "../../core/test/fixture/temp-root"

// Before HOME and XDG_CACHE_HOME are repointed below.
sharePlaywrightBrowsers()

const dir = path.join(os.tmpdir(), "redcode-tui-test-" + process.pid)
removeOnExit(dir)
afterAll(() => removeTempPaths([dir]))
const home = path.join(dir, "home")
await fs.mkdir(home, { recursive: true })

process.env.REDCODE_TEST_HOME = home
process.env.HOME = home
process.env.XDG_DATA_HOME = path.join(dir, "share")
process.env.XDG_CACHE_HOME = path.join(dir, "cache")
process.env.XDG_CONFIG_HOME = path.join(dir, "config")
process.env.XDG_STATE_HOME = path.join(dir, "state")

// No TUI test may launch a real browser from an automatic path (Design review launch, MCP OAuth);
// launcher tests inject fakes. Links a user clicks (ui/link.tsx, app.tsx, workers.tsx,
// dialog-retry-action.tsx) call `open` directly and are deliberately unguarded.
process.env.REDCODE_NO_BROWSER = "1"
process.env.REDCODE_DESIGN_NO_OPEN = "1"
