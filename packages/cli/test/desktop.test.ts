import { describe, expect, test } from "bun:test"
import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { DesktopApp } from "../src/services/desktop-app"
// The app reads the pointer this command writes; both sides of that file are checked together.
import { locateCli } from "../../desktop/src/main/service/cli-location"
import { tmpdir } from "./fixture/tmpdir"

const options = (root: string, extra: Partial<DesktopApp.Options> = {}): DesktopApp.Options => ({
  env: {},
  target: "linux-x64",
  executable: path.join(root, "redcode"),
  cache: path.join(root, "cache"),
  version: "1.2.3",
  source: false,
  ...extra,
})

/** Writes empty files at the given paths under root. */
async function files(root: string, ...names: string[]) {
  await Promise.all(names.map((name) => Bun.write(path.join(root, name), "")))
}

/** An npm install: redcode's platform package beside the desktop package, whose tar holds the given app files. */
async function npm(root: string, target: string, desktop: string, app: readonly string[]) {
  const scope = path.join(root, "node_modules", "@reddb-io")
  const tree = path.join(root, "tree")
  const extension = target.startsWith("windows-") ? ".exe" : ""
  await files(scope, `redcode-${target}/bin/redcode${extension}`)
  await files(tree, ...app)
  const folder = path.join(scope, `redcode-desktop-${desktop}`, "desktop")
  await mkdir(folder, { recursive: true })
  const child = Bun.spawn(["tar", "-cf", "desktop.tar", "-C", tree, ...(await readdir(tree))], { cwd: folder })
  expect(await child.exited).toBe(0)
  return path.join(scope, `redcode-${target}`, "bin", `redcode${extension}`)
}

describe("redcode desktop", () => {
  test.each([
    {
      layout: "a Linux archive",
      target: "linux-x64-baseline",
      app: "desktop/io.reddb.redcode",
      executable: "desktop/io.reddb.redcode",
    },
    { layout: "a Windows archive", target: "windows-arm64", app: "desktop/Redcode.exe", executable: "desktop/Redcode.exe" },
    {
      layout: "a macOS archive",
      target: "darwin-arm64",
      app: "desktop/Redcode.app",
      executable: "desktop/Redcode.app/Contents/MacOS/Redcode",
    },
  ])("opens the app unpacked beside redcode in $layout", async (input) => {
    await using root = await tmpdir()
    await files(root.path, "redcode", input.executable)
    expect(await DesktopApp.locate(options(root.path, { target: input.target }))).toEqual({
      source: "archive",
      app: path.join(root.path, input.app),
      executable: path.join(root.path, input.executable),
      root: path.join(root.path, "desktop"),
    })
  })

  test.each([
    {
      layout: "Linux",
      target: "linux-arm64",
      desktop: "linux-arm64",
      files: ["io.reddb.redcode", "resources/app.asar"],
      app: "io.reddb.redcode",
      executable: "io.reddb.redcode",
    },
    {
      layout: "Windows, from a baseline CLI",
      target: "windows-x64-baseline",
      desktop: "windows-x64",
      files: ["Redcode.exe", "resources/app.asar"],
      app: "Redcode.exe",
      executable: "Redcode.exe",
    },
    {
      layout: "macOS",
      target: "darwin-x64",
      desktop: "darwin-x64",
      files: ["Redcode.app/Contents/MacOS/Redcode", "Redcode.app/Contents/Resources/app.asar"],
      app: "Redcode.app",
      executable: "Redcode.app/Contents/MacOS/Redcode",
    },
  ])("extracts the npm package's app once per version on $layout", async (input) => {
    await using root = await tmpdir()
    const executable = await npm(root.path, input.target, input.desktop, input.files)
    const extracted = path.join(root.path, "cache", "desktop", "1.2.3")
    const expected: DesktopApp.Located = {
      source: "npm",
      app: path.join(extracted, input.app),
      executable: path.join(extracted, input.executable),
      root: extracted,
    }
    const located = await DesktopApp.locate(options(root.path, { target: input.target, executable }))
    expect(located).toEqual(expected)
    for (const file of input.files) expect(await Bun.file(path.join(extracted, file)).exists()).toBe(true)
    // Nothing is left beside the extracted app, and a second run reuses it.
    expect(await readdir(path.dirname(extracted))).toEqual(["1.2.3"])
    await Bun.write(path.join(extracted, "marker"), "")
    expect(await DesktopApp.locate(options(root.path, { target: input.target, executable }))).toEqual(expected)
    expect(await Bun.file(path.join(extracted, "marker")).exists()).toBe(true)
  })

  test("REDCODE_DESKTOP_APP wins over the installation's app and is never prepared", async () => {
    await using root = await tmpdir()
    await files(root.path, "redcode", "desktop/io.reddb.redcode")
    const env = { REDCODE_DESKTOP_APP: "/src/Redcode Dev.app" }
    const located = await DesktopApp.locate(options(root.path, { env, target: "darwin-arm64" }))
    expect(located).toEqual({
      source: "environment",
      app: "/src/Redcode Dev.app",
      executable: path.join("/src/Redcode Dev.app", "Contents", "MacOS", "Redcode Dev"),
    })
    expect(DesktopApp.preparation(located, "darwin-arm64", {})).toEqual([])
    expect(DesktopApp.sandbox(located, "linux-x64", { uid: 1000, mode: 0o100755 })).toBeUndefined()
  })

  test.each([
    { target: "linux-x64-musl", message: "Redcode Desktop is not available for linux-x64-musl" },
    { target: "linux-arm64-musl", message: "Redcode Desktop is not available for linux-arm64-musl" },
    { target: "freebsd-x64", message: "Redcode Desktop is not available for freebsd-x64" },
  ])("refuses $target", async (input) => {
    await using root = await tmpdir()
    await files(root.path, "redcode", "desktop/io.reddb.redcode")
    await expect(DesktopApp.locate(options(root.path, { target: input.target }))).rejects.toThrow(input.message)
  })

  test("names what it looked for, or how to run the app from a checkout", async () => {
    await using root = await tmpdir()
    await expect(DesktopApp.locate(options(root.path))).rejects.toThrow(
      `looked for ${path.join(root.path, "desktop", "io.reddb.redcode")} and `,
    )
    await expect(DesktopApp.locate(options(root.path, { source: "/src/packages/desktop" }))).rejects.toThrow(
      "Run it from source: cd /src/packages/desktop && bun run dev",
    )
  })

  test.each([
    {
      name: "grants the Windows sandbox access and clears Mark-of-the-Web",
      target: "windows-x64",
      located: { source: "archive", app: "C:\\redcode\\desktop\\Redcode.exe", root: "C:\\redcode\\desktop" },
      expected: [
        ["C:\\Win\\System32\\icacls.exe", "C:\\redcode\\desktop", "/grant", "*S-1-15-2-2:(OI)(CI)(RX)", "/Q"],
        [
          "C:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-ChildItem -LiteralPath 'C:\\redcode\\desktop' -Recurse -File | Unblock-File",
        ],
      ],
    },
    {
      name: "quotes a Windows folder for PowerShell",
      target: "windows-x64",
      located: { source: "npm", app: "C:\\Users\\o'neil\\Redcode.exe", root: "C:\\Users\\o'neil" },
      expected: [
        ["C:\\Win\\System32\\icacls.exe", "C:\\Users\\o'neil", "/grant", "*S-1-15-2-2:(OI)(CI)(RX)", "/Q"],
        [
          "C:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-ChildItem -LiteralPath 'C:\\Users\\o''neil' -Recurse -File | Unblock-File",
        ],
      ],
    },
    {
      name: "clears quarantine on the macOS app",
      target: "darwin-arm64",
      located: { source: "archive", app: "/opt/redcode/desktop/Redcode.app", root: "/opt/redcode/desktop" },
      expected: [["xattr", "-dr", "com.apple.quarantine", "/opt/redcode/desktop/Redcode.app"]],
    },
    {
      name: "leaves Linux alone",
      target: "linux-x64",
      located: { source: "archive", app: "/opt/redcode/desktop/io.reddb.redcode", root: "/opt/redcode/desktop" },
      expected: [],
    },
  ] satisfies {
    name: string
    target: string
    located: Omit<DesktopApp.Located, "executable">
    expected: string[][]
  }[])("prepares an app it unpacked: $name", (input) => {
    expect(
      DesktopApp.preparation({ ...input.located, executable: input.located.app }, input.target, { SystemRoot: "C:\\Win" }),
    ).toEqual(input.expected)
  })

  const linux = {
    source: "archive",
    app: "/opt/redcode/desktop/io.reddb.redcode",
    executable: "/opt/redcode/desktop/io.reddb.redcode",
    root: "/opt/redcode/desktop",
  } satisfies DesktopApp.Located
  const fix = [
    ["sudo", "chown", "root:root", path.join("/opt/redcode/desktop", "chrome-sandbox")],
    ["sudo", "chmod", "4755", path.join("/opt/redcode/desktop", "chrome-sandbox")],
  ]

  test.each([
    { name: "a setuid root helper", target: "linux-x64", stat: { uid: 0, mode: 0o104755 }, expected: undefined },
    { name: "a helper the user unpacked", target: "linux-x64", stat: { uid: 1000, mode: 0o100755 }, expected: fix },
    { name: "a root helper without setuid", target: "linux-x64", stat: { uid: 0, mode: 0o100755 }, expected: fix },
    { name: "a user-owned setuid helper", target: "linux-arm64", stat: { uid: 1000, mode: 0o104755 }, expected: fix },
    { name: "no helper", target: "linux-x64", stat: undefined, expected: undefined },
    { name: "another OS", target: "darwin-arm64", stat: { uid: 501, mode: 0o100755 }, expected: undefined },
  ])("asks for the Linux sandbox fix for $name", (input) => {
    expect(DesktopApp.sandbox(linux, input.target, input.stat)?.commands).toEqual(input.expected)
  })

  test.each([
    {
      platform: "linux",
      app: "/home/me/.red/code/cache/desktop/1.2.3/io.reddb.redcode",
      resourcesPath: "/home/me/.red/code/cache/desktop/1.2.3/resources",
      execPath: "/home/me/.red/code/cache/desktop/1.2.3/io.reddb.redcode",
    },
    {
      platform: "darwin",
      app: "/Users/me/.red/code/cache/desktop/1.2.3/Redcode.app",
      resourcesPath: "/Users/me/.red/code/cache/desktop/1.2.3/Redcode.app/Contents/Resources",
      execPath: "/Users/me/.red/code/cache/desktop/1.2.3/Redcode.app/Contents/MacOS/Redcode",
    },
  ] as const)("the $platform app it extracted finds this CLI through the pointer", (input) => {
    const cli = "/home/me/node_modules/@reddb-io/redcode-linux-x64/bin/redcode"
    const pointer = DesktopApp.pointer("/home/me/.red/code/state")
    expect(pointer).toBe(path.join("/home/me/.red/code/state", "desktop.json"))
    const record = DesktopApp.record({ version: "1.2.3", cli, app: input.app })
    expect(
      locateCli({
        env: {},
        platform: input.platform,
        resourcesPath: input.resourcesPath,
        execPath: input.execPath,
        version: "1.2.3",
        pointer,
        exists: (file) => file === cli,
        read: (file) => (file === pointer ? record : undefined),
      }),
    ).toEqual({ source: "pointer", binary: cli, version: "1.2.3" })
  })
})
