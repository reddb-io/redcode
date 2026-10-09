#!/usr/bin/env bun
import { $ } from "bun"
import { installCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

await $`bun ./scripts/copy-metainfo.ts ${channel}`

await installCliToResources()
