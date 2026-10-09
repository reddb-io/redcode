import { expect, test } from "bun:test"
import path from "node:path"
import { realpath } from "node:fs/promises"
import { DesignAppBinary } from "../src/design/app-binary"
import { tmpdir } from "./fixture/tmpdir"

const options = (extra: Partial<DesignAppBinary.Options> = {}): DesignAppBinary.Options => ({
  target: "linux-x64",
  source: false,
  env: {},
  executable: path.join(import.meta.dir, "no-installation", "redcode"),
  ...extra,
})

test("REDCODE_DESIGN_BIN wins over the checkout source, which wins over the installed app", async () => {
  await using install = await tmpdir()
  const cli = path.join(install.path, "redcode")
  await Bun.write(cli, "")
  await Bun.write(path.join(install.path, "redcode-design"), "")
  const entry = path.join(install.path, "index.ts")
  expect(
    DesignAppBinary.command(
      options({ env: { REDCODE_DESIGN_BIN: "/opt/redcode-design" }, source: entry, executable: cli }),
    ),
  ).toEqual(["/opt/redcode-design"])
  expect(DesignAppBinary.command(options({ source: entry, executable: cli }))).toEqual([process.execPath, entry])
  // Unless told otherwise, a redcode run from this checkout with Bun runs the app from its source.
  expect(DesignAppBinary.command(options({ source: undefined, executable: cli }))).toEqual([
    process.execPath,
    path.resolve(import.meta.dir, "../../design-app/src/index.ts"),
  ])
})

test.each([
  { layout: "a release archive", target: "linux-x64", cli: "redcode", design: "redcode-design" },
  { layout: "a Windows release archive", target: "windows-x64", cli: "redcode.exe", design: "redcode-design.exe" },
  {
    layout: "an npm install",
    target: "linux-x64-baseline-musl",
    cli: "node_modules/@reddb-io/redcode-linux-x64-baseline-musl/bin/redcode",
    design: "node_modules/@reddb-io/redcode-design-linux-x64-baseline-musl/bin/redcode-design",
  },
  {
    layout: "a Windows npm install",
    target: "windows-arm64",
    cli: "node_modules/@reddb-io/redcode-windows-arm64/bin/redcode.exe",
    design: "node_modules/@reddb-io/redcode-design-windows-arm64/bin/redcode-design.exe",
  },
])("runs the design app shipped beside redcode in $layout", async (input) => {
  await using install = await tmpdir()
  const cli = path.join(install.path, input.cli)
  const design = path.join(install.path, input.design)
  await Bun.write(cli, "")
  await Bun.write(design, "")
  expect(DesignAppBinary.command(options({ executable: cli, target: input.target }))).toEqual([await realpath(design)])
})

test("an installation without its own target's design app names the paths it checked", async () => {
  await using install = await tmpdir()
  const cli = path.join(install.path, "@reddb-io/redcode-linux-x64/bin/redcode")
  await Bun.write(cli, "")
  // Another target's app is not this redcode's.
  await Bun.write(path.join(install.path, "@reddb-io/redcode-design-linux-arm64/bin/redcode-design"), "")
  const real = await realpath(cli)
  expect(() => DesignAppBinary.command(options({ executable: cli }))).toThrow(
    `looked for ${path.join(path.dirname(real), "redcode-design")} and ${path.join(path.dirname(path.dirname(path.dirname(real))), "redcode-design-linux-x64", "bin", "redcode-design")}`,
  )
})

test("reports a start until it is cleared", () => {
  const seen: (DesignAppBinary.Progress | undefined)[] = []
  const stop = DesignAppBinary.watch((progress) => seen.push(progress))
  DesignAppBinary.report({ phase: "start", started: 1 })
  expect(DesignAppBinary.progress()).toEqual({ phase: "start", started: 1 })
  DesignAppBinary.report()
  stop()
  DesignAppBinary.report({ phase: "start", started: 2 })
  DesignAppBinary.report()
  expect(seen).toEqual([{ phase: "start", started: 1 }, undefined])
  expect(DesignAppBinary.progress()).toBeUndefined()
})
