#!/usr/bin/env bun

import "@opencode/util/env-alias"
import { DesignAppBinary } from "@opencode/core/design/app-binary"

// Design keeps its own process and database lifecycle while sharing the CLI's runtime.
if (process.argv[2] === DesignAppBinary.SUBCOMMAND) {
  const { run } = await import("@reddb-io/redcode-design-app/main")
  await run(process.argv.slice(3))
} else {
  await import("./index")
}
