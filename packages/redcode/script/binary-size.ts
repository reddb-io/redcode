#!/usr/bin/env bun

// Reports the size of a compiled redcode binary and fails when it grows past the baseline recorded
// in binary-size.json, so a dependency that bloats the binary is caught in review. The allowance
// absorbs day-to-day drift such as the embedded models catalog; a deliberate growth updates the
// baseline with --update.
//
// Usage: binary-size.ts <binary> [--target linux-x64] [--baseline <file>] [--update]

import path from "path"
import { parseArgs } from "node:util"

export type Baseline = Record<string, { readonly bytes: number; readonly allowance: number }>

export function check(size: number, baseline: Baseline[string] | undefined) {
  if (!baseline) return { ok: false, delta: undefined, limit: undefined }
  const limit = baseline.bytes + baseline.allowance
  return { ok: size <= limit, delta: size - baseline.bytes, limit }
}

export function report(target: string, size: number, baseline: Baseline[string] | undefined) {
  const result = check(size, baseline)
  if (!baseline || result.limit === undefined || result.delta === undefined)
    return { ok: false, text: `redcode ${target}: ${bytes(size)}; no baseline is recorded for ${target}` }
  const sign = result.delta > 0 ? "+" : result.delta < 0 ? "-" : "±"
  const text = `redcode ${target}: ${bytes(size)}; baseline ${bytes(baseline.bytes)}; change ${sign}${bytes(Math.abs(result.delta))}; limit ${bytes(result.limit)}`
  if (result.ok) return { ok: true, text }
  return {
    ok: false,
    text: `${text}\nThe binary grew past its baseline. Keep heavy code out of the redcode bundle, or record the new size with: bun packages/redcode/script/binary-size.ts <binary> --target ${target} --update`,
  }
}

function bytes(value: number) {
  return `${(value / 1024 / 1024).toFixed(2)} MiB (${value.toLocaleString("en-US")} bytes)`
}

if (import.meta.main) {
  const args = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: "string", default: "linux-x64" },
      baseline: { type: "string", default: path.join(import.meta.dir, "binary-size.json") },
      update: { type: "boolean", default: false },
    },
  })
  const binary = args.positionals[0]
  if (!binary) throw new Error("Usage: binary-size.ts <binary> [--target linux-x64] [--baseline <file>] [--update]")
  const size = Bun.file(binary).size
  if (!size) throw new Error(`${binary} is missing or empty`)
  const recorded: Baseline = await Bun.file(args.values.baseline)
    .json()
    .catch(() => ({}))
  const target = args.values.target
  if (args.values.update) {
    await Bun.write(
      args.values.baseline,
      `${JSON.stringify({ ...recorded, [target]: { bytes: size, allowance: recorded[target]?.allowance ?? 2 * 1024 * 1024 } }, null, 2)}\n`,
    )
    console.log(`recorded ${target}: ${bytes(size)}`)
    process.exit(0)
  }
  const result = report(target, size, recorded[target])
  console.log(result.text)
  if (process.env.GITHUB_STEP_SUMMARY)
    await Bun.write(
      process.env.GITHUB_STEP_SUMMARY,
      `${await Bun.file(process.env.GITHUB_STEP_SUMMARY)
        .text()
        .catch(() => "")}### redcode binary size\n\n${result.text.replaceAll("\n", "\n\n")}\n`,
    )
  if (!result.ok) process.exit(1)
}
