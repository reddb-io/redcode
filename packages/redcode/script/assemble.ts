#!/usr/bin/env bun

// Ships the design app beside redcode. For every redcode platform package in dist/, writes the
// @reddb-io/redcode-design-<target> package from the binary packages/design-app built for that target
// (REDCODE_DESIGN_DIST), and makes it an optional dependency of the CLI package too, so pnpm's isolated
// layout links it next to redcode, where the CLI looks for it. Runs after `bun run build`, before
// `bun run archive` and `bun run publish`.

import { chmod, rm } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"
import { RedcodePackages } from "./packages"

const directory = path.resolve(import.meta.dir, "..")
const dist = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--dist="))?.slice(7) ?? "dist")
const source = RedcodePackages.designDist(directory)
const cli = (await RedcodePackages.list(dist, Script.version)).filter((item) => item.kind === "cli")
if (cli.length === 0) throw new Error(`No Redcode native packages in ${dist}`)

await Promise.all(
  cli.map(async (item) => {
    const name = `@reddb-io/redcode-design-${item.target}`
    const output = path.join(dist, `redcode-design-${item.target}`)
    const binary = RedcodePackages.binaries({ kind: "design", target: item.target })[0]!
    const built = path.join(source, `redcode-design-${item.target}`, binary)
    if (!(await Bun.file(built).exists())) throw new Error(`Missing design app for ${item.target}: ${built}`)
    await rm(output, { recursive: true, force: true })
    await Bun.write(path.join(output, "bin", binary), Bun.file(built))
    if (!item.target.startsWith("windows-")) await chmod(path.join(output, "bin", binary), 0o755)
    await Bun.write(path.join(output, "LICENSE"), Bun.file(path.join(directory, "../../LICENSE")))
    await Bun.write(path.join(output, "NOTICE"), Bun.file(path.join(directory, "../../NOTICE")))
    await Bun.write(
      path.join(output, "package.json"),
      JSON.stringify(
        {
          name,
          version: Script.version,
          license: item.manifest.license,
          repository: item.manifest.repository,
          os: item.manifest.os,
          cpu: item.manifest.cpu,
        },
        null,
        2,
      ),
    )
    await Bun.write(
      path.join(item.dir, "package.json"),
      JSON.stringify({ ...item.manifest, optionalDependencies: { [name]: Script.version } }, null, 2),
    )
  }),
)
console.log(`Assembled the design app beside ${cli.length} Redcode native packages in ${dist}`)
