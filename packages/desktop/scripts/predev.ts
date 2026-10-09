import { $ } from "bun"

// Development runs against the `redcode` on PATH (or REDCODE_BIN), so only the Electron binary is needed.
await $`bun run install-electron`
