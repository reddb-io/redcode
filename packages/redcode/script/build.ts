#!/usr/bin/env bun

import path from "node:path"

const packageDirectory = path.resolve(import.meta.dir, "..")
const outdir = process.argv.find((arg) => arg.startsWith("--outdir="))?.slice("--outdir=".length)
const output = path.resolve(packageDirectory, outdir ?? "dist")
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--outdir="))
const build = Bun.spawn(
  ["bun", path.resolve(packageDirectory, "../cli/script/build.ts"), `--outdir=${output}`, ...args],
  {
    cwd: packageDirectory,
    env: { ...process.env, REDCODE_BUILD: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
)
process.exit(await build.exited)
