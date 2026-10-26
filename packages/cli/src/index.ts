#!/usr/bin/env bun

import "@opencode/util/env-alias"
import { OPENCODE_VERSION } from "./version"

declare const OPENCODE_CLI_NAME: string | undefined

// Version queries must work even when storage, configuration or telemetry cannot initialize.
if (
  !process.env.OPENCODE_SSH_ASKPASS_PORT &&
  process.argv.length === 3 &&
  (process.argv[2] === "--version" || process.argv[2] === "-v")
) {
  process.stdout.write(
    `${typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode"} v${OPENCODE_VERSION}\n`,
  )
} else {
  await import("./main")
}
