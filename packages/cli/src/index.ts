#!/usr/bin/env bun

import "@opencode/util/env-alias"
import { OPENCODE_VERSION } from "./version"

// Keep requests to the local service off environment proxies. Bun prefers lowercase `no_proxy` whenever it is set,
// so both spellings must contain the same merged list.
const noProxy = [
  ...new Set(
    [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
      (value ?? "").split(",").flatMap((entry) => entry.trim() || []),
    ),
  ),
].join(",")

process.env.NO_PROXY = noProxy
process.env.no_proxy = noProxy

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
