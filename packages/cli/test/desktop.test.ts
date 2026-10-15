import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { symlink } from "node:fs/promises"
import path from "node:path"
import { DesktopApp } from "../src/services/desktop-app"
// The app reads the pointer this command writes; both sides of that file are checked together.
import { locateCli } from "../../desktop/src/main/service/cli-location"
import { tmpdir } from "./fixture/tmpdir"

const fixture = await tmpdir()
const app = path.join(fixture.path, process.platform === "win32" ? "desktop.exe" : "desktop")

beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "fixture/desktop-app.ts")],
    compile: { outfile: app, autoloadBunfig: false, autoloadDotenv: false },
  })
  if (!result.success) throw new AggregateError(result.logs, "Could not build desktop process fixture")
})

afterAll(() => fixture[Symbol.asyncDispose]())

const options = (root: string, extra: Partial<DesktopApp.Options> = {}): DesktopApp.Options => ({
  env: {},
  target: "linux-x64",
  executable: path.join(root, "redcode"),
  source: false,
  ...extra,
})

/** Writes empty files at the given paths under root. */
async function files(root: string, ...names: string[]) {
  await Promise.all(names.map((name) => Bun.write(path.join(root, name), "")))
}

describe("redcode desktop", () => {
  test.each([
    { target: "linux-x64", env: { DISPLAY: ":7", XAUTHORITY: "/forwarded/auth" } },
    { target: "linux-arm64", env: { WAYLAND_DISPLAY: "wayland-3" } },
    { target: "windows-x64", env: { SESSIONNAME: "Console" } },
    { target: "darwin-arm64", env: { TERM: "xterm-256color" } },
  ])("preserves explicit graphical sessions and native $target environments", async (input) => {
    expect(await DesktopApp.environment(input.env, input.target)).toEqual(input.env)
  })

  test.skipIf(process.platform !== "linux")(
    "recovers only missing graphical session variables from systemd",
    async () => {
      await using root = await tmpdir()
      await symlink(app, path.join(root.path, "systemctl"))
      const env = {
        PATH: root.path,
        XDG_RUNTIME_DIR: "/explicit/runtime",
        REDCODE_DESKTOP_FIXTURE_SESSION: JSON.stringify({
          DISPLAY: ":0",
          WAYLAND_DISPLAY: "wayland-0",
          XAUTHORITY: "/a path/with spaces/auth",
          XDG_RUNTIME_DIR: "/session/runtime",
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/session/bus",
          PATH: "/unrelated/path",
          REDCODE_DESKTOP_CLI: "/unrelated/cli",
        }),
      }
      expect(await DesktopApp.environment(env, "linux-x64")).toEqual({
        ...env,
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
        XAUTHORITY: "/a path/with spaces/auth",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/session/bus",
      })
    },
  )

  test.skipIf(process.platform !== "linux").each([
    { name: "no systemd", session: undefined },
    { name: "no graphical session", session: "{}" },
    { name: "invalid session data", session: "not json" },
    { name: "invalid session values", session: '{"DISPLAY":5}' },
  ])("explains how to launch from a graphical terminal with $name", async (input) => {
    await using root = await tmpdir()
    if (input.session) await symlink(app, path.join(root.path, "systemctl"))
    await expect(
      DesktopApp.environment({ PATH: root.path, REDCODE_DESKTOP_FIXTURE_SESSION: input.session }, "linux-x64"),
    ).rejects.toThrow("Run redcode desktop from a terminal in your desktop session")
  })

  // A real executable exercises exit codes, stderr inheritance and detachment on every CI OS.
  test.each(
    [
      { mode: "crash", message: "exit code 23", diagnostic: "desktop startup fixture failed" },
      { mode: "large-error", message: "exit code 24", diagnostic: "last startup diagnostic" },
      { mode: "signal", message: "SIGTERM", diagnostic: "" },
    ].filter((input) => process.platform !== "win32" || input.mode !== "signal"),
  )("reports an early $mode with a bounded diagnostic and a log path", async (input) => {
    await using root = await tmpdir()
    const log = path.join(root.path, "log", "desktop.log")
    const error = await DesktopApp.launch(
      { source: "environment", app, executable: app },
      { env: { ...process.env, REDCODE_DESKTOP_FIXTURE_MODE: input.mode }, log },
    ).then(
      () => undefined,
      (cause: Error) => cause,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toContain(input.message)
    expect(error?.message).toContain(input.diagnostic)
    expect(error?.message).toContain(`Startup log: ${log}`)
    expect(error!.message.length).toBeLessThan(9000)
    if (input.mode === "large-error") expect(await Bun.file(log).text()).toStartWith("first diagnostic")
  })

  test("reports a missing executable instead of succeeding", async () => {
    await using root = await tmpdir()
    const executable = path.join(root.path, "missing-desktop")
    await expect(
      DesktopApp.launch(
        { source: "environment", app: executable, executable },
        { env: process.env, log: path.join(root.path, "desktop.log") },
      ),
    ).rejects.toThrow(`Could not start Redcode Desktop at ${executable}`)
  })

  test("accepts a clean handoff to an existing desktop", async () => {
    await using root = await tmpdir()
    await DesktopApp.launch(
      { source: "environment", app, executable: app },
      { env: { ...process.env, REDCODE_DESKTOP_FIXTURE_MODE: "handoff" }, log: path.join(root.path, "desktop.log") },
    )
  })

  test("leaves a running desktop detached with its CLI and writable diagnostics", async () => {
    await using root = await tmpdir()
    const state = path.join(root.path, "state.json")
    const log = path.join(root.path, "desktop.log")
    const launched = DesktopApp.launch(
      { source: "environment", app, executable: app },
      {
        cli: "/installation/redcode",
        env: { ...process.env, REDCODE_DESKTOP_FIXTURE_MODE: "running", REDCODE_DESKTOP_FIXTURE_STATE: state },
        log,
      },
    )
    try {
      await launched
      const running = await Bun.file(state).json()
      expect(running.cli).toBe("/installation/redcode")
      expect(isRunning(running.pid)).toBe(true)
      // Ask the detached child to write after the launcher's log descriptor has closed.
      await Bun.write(path.join(root.path, "write"), "")
      const deadline = Date.now() + 2000
      while (!(await Bun.file(log).text()).includes("still writable") && Date.now() < deadline) await Bun.sleep(20)
      expect(await Bun.file(log).text()).toContain("still writable")
    } finally {
      if (await Bun.file(state).exists()) {
        const pid = (await Bun.file(state).json()).pid
        process.kill(pid, "SIGKILL")
        const deadline = Date.now() + 2000
        while (isRunning(pid) && Date.now() < deadline) await Bun.sleep(20)
        expect(isRunning(pid)).toBe(false)
      }
    }
  }, 10_000)

  test.each([
    {
      layout: "a Linux archive",
      target: "linux-x64-baseline",
      app: "desktop/io.reddb.redcode",
      executable: "desktop/io.reddb.redcode",
    },
    {
      layout: "a Windows archive",
      target: "windows-arm64",
      app: "desktop/Redcode.exe",
      executable: "desktop/Redcode.exe",
    },
    {
      layout: "a macOS archive",
      target: "darwin-arm64",
      app: "desktop/Redcode.app",
      executable: "desktop/Redcode.app/Contents/MacOS/Redcode",
    },
  ])("opens the app unpacked beside redcode in $layout", async (input) => {
    await using root = await tmpdir()
    await files(root.path, "redcode", input.executable)
    expect(DesktopApp.locate(options(root.path, { target: input.target }))).toEqual({
      source: "archive",
      app: path.join(root.path, input.app),
      executable: path.join(root.path, input.executable),
      root: path.join(root.path, "desktop"),
    })
  })

  test.each([
    { target: "linux-arm64", binary: "redcode" },
    { target: "windows-x64-baseline", binary: "redcode.exe" },
    { target: "darwin-x64", binary: "redcode" },
  ])("points an npm install on $target to mise or the release archive", async (input) => {
    await using root = await tmpdir()
    const executable = path.join(root.path, "node_modules", "@reddb-io", `redcode-${input.target}`, "bin", input.binary)
    const located = () => DesktopApp.locate(options(root.path, { target: input.target, executable }))
    expect(located).toThrow("Redcode Desktop is not included in the npm package")
    expect(located).toThrow("mise use -g github:reddb-io/redcode@latest")
    expect(located).toThrow("https://github.com/reddb-io/redcode/releases")
  })

  test("REDCODE_DESKTOP_APP wins over the installation's app and is never prepared", async () => {
    await using root = await tmpdir()
    await files(root.path, "redcode", "desktop/io.reddb.redcode")
    const env = { REDCODE_DESKTOP_APP: "/src/Redcode Dev.app" }
    const located = DesktopApp.locate(options(root.path, { env, target: "darwin-arm64" }))
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
    expect(() => DesktopApp.locate(options(root.path, { target: input.target }))).toThrow(input.message)
  })

  test("names what it looked for, or how to run the app from a checkout", async () => {
    await using root = await tmpdir()
    expect(() => DesktopApp.locate(options(root.path))).toThrow(
      `looked for ${path.join(root.path, "desktop", "io.reddb.redcode")}. Reinstall redcode from the release archive`,
    )
    expect(() => DesktopApp.locate(options(root.path, { source: "/src/packages/desktop" }))).toThrow(
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
      located: { source: "archive", app: "C:\\Users\\o'neil\\Redcode.exe", root: "C:\\Users\\o'neil" },
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
      DesktopApp.preparation({ ...input.located, executable: input.located.app }, input.target, {
        SystemRoot: "C:\\Win",
      }),
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
      app: "/home/me/apps/redcode-dev/io.reddb.redcode",
      resourcesPath: "/home/me/apps/redcode-dev/resources",
      execPath: "/home/me/apps/redcode-dev/io.reddb.redcode",
    },
    {
      platform: "darwin",
      app: "/Users/me/Applications/Redcode.app",
      resourcesPath: "/Users/me/Applications/Redcode.app/Contents/Resources",
      execPath: "/Users/me/Applications/Redcode.app/Contents/MacOS/Redcode",
    },
  ] as const)("the $platform app REDCODE_DESKTOP_APP names finds this CLI through the pointer", (input) => {
    const cli = "/home/me/.local/share/mise/installs/redcode/1.2.3/redcode"
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

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
