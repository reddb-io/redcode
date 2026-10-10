import { afterAll } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = await mkdtemp(join(tmpdir(), "redcode-sdk-tests-"))
Object.assign(process.env, {
  HOME: root,
  USERPROFILE: root,
  OPENCODE_TEST_HOME: root,
  REDCODE_TEST_HOME: root,
  OPENCODE_CONFIG_DIR: join(root, "config"),
  OPENCODE_CONFIG_CONTENT: "{}",
  XDG_CONFIG_HOME: join(root, "xdg-config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
  REDCODE_REASONING: "single",
  REDCODE_NO_BROWSER: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_FILEWATCHER: "true",
  NPM_CONFIG_AUDIT: "false",
})
delete process.env.OPENCODE_CONFIG
delete process.env.OPENCODE_DB
delete process.env.REDCODE_DB
delete process.env.OPENCODE_CLI_CONFIG_CONTENT
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
