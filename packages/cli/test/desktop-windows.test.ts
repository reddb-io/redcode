import { expect, test } from "bun:test"
import { cp, mkdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { DesktopApp } from "../src/services/desktop-app"
import { DesktopWindows } from "../src/services/desktop-windows"
import { tmpdir } from "./fixture/tmpdir"

const registry = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RedcodeDesktop",
  "HKCU\\Software\\Classes\\redcode",
]

// One boundary owns installation, upgrade and Settings uninstall: real files, shortcuts, registry and processes.
test.skipIf(process.platform !== "win32")(
  "Windows Desktop survives deleting the archive and uninstalls only its own payload",
  async () => {
    await using fixture = await tmpdir()
    const env = {
      ...process.env,
      LOCALAPPDATA: path.join(fixture.path, "Local ' João"),
      APPDATA: path.join(fixture.path, "Roaming"),
      REDCODE_TEST_HOME: path.join(fixture.path, "Home"),
    }
    const root = path.join(env.LOCALAPPDATA, "Programs", "Redcode")
    const archive = path.join(fixture.path, "extracted archive")
    const state = path.join(fixture.path, "state.json")
    const outsideState = path.join(fixture.path, "outside.json")
    const shortcut = path.join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Redcode.lnk")
    const backups = await Promise.all(
      registry.map(async (key, index) => {
        const file = path.join(fixture.path, `registry-${index}.reg`)
        const result = await run(["reg.exe", "export", key, file, "/y"])
        return { key, file, exists: result.code === 0 }
      }),
    )
    const children: ReturnType<typeof Bun.spawn>[] = []
    try {
      await mkdir(path.join(archive, "desktop"), { recursive: true })
      const built = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "fixture", "desktop-app.ts")],
        compile: {
          outfile: path.join(archive, "desktop", "Redcode.exe"),
          autoloadBunfig: false,
          autoloadDotenv: false,
        },
      })
      if (!built.success) throw new AggregateError(built.logs)
      await cp(path.join(process.env.SystemRoot!, "System32", "whoami.exe"), path.join(archive, "redcode.exe"))
      await Bun.write(path.join(archive, "redcode-rpc-sidecar.exe"), "sidecar fixture")
      await Bun.write(path.join(archive, "unrelated-download.txt"), "keep")
      const located = DesktopApp.locate({
        env,
        target: "windows-x64",
        executable: path.join(archive, "redcode.exe"),
        source: false,
      })
      const input = { located, cli: path.join(archive, "redcode.exe"), version: "1.2.3", target: "windows-x64", env }

      // Never claim a nonempty directory that does not carry our ownership marker.
      await Bun.write(path.join(root, "unrelated.txt"), "keep")
      await expect(DesktopWindows.install(input)).rejects.toThrow()
      expect(await Bun.file(path.join(root, "unrelated.txt")).text()).toBe("keep")
      await rm(path.join(root, "unrelated.txt"))
      await expect(DesktopWindows.install({ ...input, version: "../../outside" })).rejects.toThrow("release version")

      const first = await DesktopWindows.install(input)
      const canonical = await realpath(root)
      expect(first.located.app).toBe(path.join(canonical, "app", "1.2.3-windows-x64", "desktop", "Redcode.exe"))
      expect(first.cli).toBe(path.join(canonical, "app", "1.2.3-windows-x64", "redcode.exe"))
      expect(await Bun.file(path.join(path.dirname(first.cli), "unrelated-download.txt")).exists()).toBe(false)
      expect(await Bun.file(path.join(path.dirname(first.cli), "redcode-rpc-sidecar.exe")).text()).toBe(
        "sidecar fixture",
      )
      expect(await DesktopWindows.install(input)).toEqual(first)

      const registration = await ps(
        `
      $key = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RedcodeDesktop'
      $link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:REDCODE_SHORTCUT)
      @{ name=$key.DisplayName; version=$key.DisplayVersion; location=$key.InstallLocation; uninstall=$key.UninstallString; quiet=$key.QuietUninstallString; target=$link.TargetPath } | ConvertTo-Json -Compress
    `,
        { ...env, REDCODE_SHORTCUT: shortcut },
      )
      expect(registration.code).toBe(0)
      const record = JSON.parse(registration.stdout)
      expect(record).toMatchObject({
        name: "Redcode",
        version: "1.2.3",
        location: canonical,
        target: first.located.app,
      })
      expect(record.uninstall).toContain(`-File "${path.join(canonical, "uninstall.ps1")}"`)
      expect(record.quiet).toBe(record.uninstall + " -Quiet")

      const old = Bun.spawn([first.located.executable], {
        env: { ...env, REDCODE_DESKTOP_FIXTURE_MODE: "running", REDCODE_DESKTOP_FIXTURE_STATE: state },
        stdout: "ignore",
        stderr: "ignore",
      })
      children.push(old)
      await waitFile(state)
      const next = await DesktopWindows.install({ ...input, version: "1.2.4" })
      expect(old.exitCode).toBeNull()
      expect(await Bun.file(first.located.executable).exists()).toBe(true)
      old.kill()
      await old.exited
      await DesktopWindows.install({ ...input, version: "1.2.4" })
      expect(await Bun.file(first.located.executable).exists()).toBe(false)
      expect(await Bun.file(next.located.executable).exists()).toBe(true)

      // Both the CLI and app are independent of the download, including when launched from Start.
      const outside = path.join(fixture.path, "other installation", "Redcode.exe")
      await mkdir(path.dirname(outside), { recursive: true })
      await cp(next.located.executable, outside)
      await rm(archive, { recursive: true })
      expect((await run([next.cli])).code).toBe(0)
      await Bun.write(path.join(env.APPDATA, "io.reddb.redcode", "sessions.fixture"), "keep sessions")
      const pointer = path.join(env.REDCODE_TEST_HOME, ".red", "code", "state", "desktop.json")
      await Bun.write(pointer, DesktopApp.record({ version: "1.2.4", cli: next.cli, app: next.located.app }))
      const installed = Bun.spawn([next.located.executable], {
        env: { ...env, REDCODE_DESKTOP_FIXTURE_MODE: "running", REDCODE_DESKTOP_FIXTURE_STATE: state },
        stdout: "ignore",
        stderr: "ignore",
      })
      const unrelated = Bun.spawn([outside], {
        env: { ...env, REDCODE_DESKTOP_FIXTURE_MODE: "running", REDCODE_DESKTOP_FIXTURE_STATE: outsideState },
        stdout: "ignore",
        stderr: "ignore",
      })
      children.push(installed, unrelated)
      await waitFile(outsideState)
      await waitFile(state)

      // Moving the uninstaller outside its owned root must never turn it into a recursive remover.
      await cp(path.join(root, "uninstall.ps1"), path.join(fixture.path, "uninstall.ps1"))
      const refused = await uninstall(path.join(fixture.path, "uninstall.ps1"), env)
      expect(refused.code).not.toBe(0)
      expect(await Bun.file(next.located.app).exists()).toBe(true)

      const removed = await uninstall(path.join(root, "uninstall.ps1"), env)
      expect(removed.code).toBe(0)
      await installed.exited
      expect(unrelated.exitCode).toBeNull()
      expect(await Bun.file(next.located.app).exists()).toBe(false)
      expect(await Bun.file(shortcut).exists()).toBe(false)
      expect(await Bun.file(pointer).exists()).toBe(false)
      expect(await Bun.file(path.join(env.APPDATA, "io.reddb.redcode", "sessions.fixture")).text()).toBe(
        "keep sessions",
      )
      expect((await run(["reg.exe", "query", registry[0]])).code).not.toBe(0)
      expect((await run(["reg.exe", "query", registry[1]])).code).not.toBe(0)
    } finally {
      for (const child of children) {
        if (child.exitCode === null) child.kill()
        await child.exited
      }
      for (const backup of backups) {
        await run(["reg.exe", "delete", backup.key, "/f"])
        if (backup.exists) expect((await run(["reg.exe", "import", backup.file])).code).toBe(0)
      }
    }
  },
  120_000,
)

async function run(command: string[], env = process.env) {
  const child = Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

function ps(script: string, env = process.env) {
  return run(
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from("[Console]::OutputEncoding = [Text.UTF8Encoding]::new();\n" + script, "utf16le").toString("base64"),
    ],
    env,
  )
}

function uninstall(file: string, env: NodeJS.ProcessEnv) {
  return run(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, "-Quiet"],
    env,
  )
}

async function waitFile(file: string) {
  const deadline = Date.now() + 5000
  while (!(await Bun.file(file).exists()) && Date.now() < deadline) await Bun.sleep(20)
  expect(await Bun.file(file).exists()).toBe(true)
}
