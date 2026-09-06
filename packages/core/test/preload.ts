// IMPORTANT: these run before any import from src/, because `src/global.ts` resolves the app home
// at module scope. Without REDCODE_TEST_HOME it resolves to the developer's — or the runner's —
// real `~/.red/code`, and then creates directories in it, shares a `cache/bin` across
// concurrent jobs, and lets an ambient `~/.npmrc` reach the installer under test.
import os from "os"
import path from "path"
import fs from "fs/promises"

const dir = path.join(os.tmpdir(), "redcode-core-test-" + process.pid)
// The home is shared by every core test process rather than per-pid, deliberately: `Global.Path.bin`
// hangs off it and is where ripgrep lands when the machine has none on PATH. Per-pid would isolate
// correctly and make every suite download it again.
const home = path.join(os.tmpdir(), "redcode-core-test-home")
await fs.mkdir(home, { recursive: true })

process.env.REDCODE_TEST_HOME = home
process.env.HOME = home
process.env.XDG_DATA_HOME = path.join(dir, "share")
process.env.XDG_CACHE_HOME = path.join(dir, "cache")
process.env.XDG_CONFIG_HOME = path.join(dir, "config")
process.env.XDG_STATE_HOME = path.join(dir, "state")

process.env.REDCODE_DB = ":memory:"
process.env.REDCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.REDCODE_DISABLE_MODELS_FETCH = "true"
// The installer under test must never reach npm's audit endpoint.
process.env.NPM_CONFIG_AUDIT = "false"

// A key left in the runner's environment changes which providers exist, which is not something a
// unit suite should be able to notice.
for (const key of [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "XAI_API_KEY",
  "REDCODE_SERVER_PASSWORD",
  "REDCODE_SERVER_USERNAME",
  "REDCODE_EXPERIMENTAL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
]) {
  delete process.env[key]
}
