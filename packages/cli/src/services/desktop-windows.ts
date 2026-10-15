export * as DesktopWindows from "./desktop-windows"

import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cp, lstat, mkdir, readdir, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Schema } from "effect"
import type { DesktopApp } from "./desktop-app"

const identity = "io.reddb.redcode"
const manifest = ".redcode-desktop.json"
const Ownership = Schema.fromJsonString(Schema.Struct({ id: Schema.Literal(identity) }))

/** Owns only the per-user Desktop installation; project files and shared server data live elsewhere. */
export async function install(input: {
  located: DesktopApp.Located
  cli: string
  version: string
  target: string
  env: NodeJS.ProcessEnv
}) {
  if (!input.target.startsWith("windows-") || input.located.source !== "archive")
    return { located: input.located, cli: input.cli }
  if (
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(input.version) ||
    !/^windows-(?:x64|arm64)(?:-baseline)?$/.test(input.target)
  )
    throw new Error("Redcode Desktop requires a release version and a supported Windows target to install")
  if (!input.env.LOCALAPPDATA || !input.env.APPDATA)
    throw new Error("Redcode Desktop installation requires LOCALAPPDATA and APPDATA")
  if (!input.located.root) throw new Error("Redcode Desktop archive is missing its app directory")

  const root = await owned(path.resolve(input.env.LOCALAPPDATA, "Programs", "Redcode"))
  const destination = path.join(root, "app", `${input.version}-${input.target}`)
  const binary = path.join(destination, "redcode.exe")
  const app = path.join(destination, "desktop", "Redcode.exe")
  const staged = path.join(root, `staging-${randomUUID()}`)
  const existing = await Bun.file(path.join(destination, manifest)).exists()
  if (!existing) {
    await mkdir(staged, { recursive: true })
    try {
      // Copy the release's payload, never the user's entire download directory.
      await cp(input.located.root, path.join(staged, "desktop"), { recursive: true, dereference: true })
      await cp(input.cli, path.join(staged, "redcode.exe"))
      await cp(
        path.join(path.dirname(input.cli), "redcode-rpc-sidecar.exe"),
        path.join(staged, "redcode-rpc-sidecar.exe"),
      )
      await Bun.write(
        path.join(staged, manifest),
        JSON.stringify({ id: identity, version: input.version, target: input.target }),
      )
      await mkdir(path.dirname(destination), { recursive: true })
      await rename(staged, destination)
    } finally {
      // The staging path is a direct child of the owned install root, never an archive path.
      await rm(staged, { recursive: true, force: true })
    }
  }
  await Schema.decodeUnknownPromise(Ownership)(await Bun.file(path.join(destination, manifest)).text())
  if (!(await Bun.file(app).exists()) || !(await Bun.file(binary).exists()))
    throw new Error(`Redcode Desktop installation is incomplete: ${destination}`)
  await Bun.write(path.join(root, "uninstall.ps1"), "\ufeff" + uninstallScript)
  const config = Buffer.from(JSON.stringify({ root, app, version: input.version }), "utf8").toString("base64")
  await powershell(
    `$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}')) | ConvertFrom-Json\n${registerScript}`,
    input.env,
  )
  return {
    located: { source: "archive", app, executable: app, root: path.dirname(app) } satisfies DesktopApp.Located,
    cli: binary,
  }
}

async function owned(root: string) {
  const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  if (entries.length) await Schema.decodeUnknownPromise(Ownership)(await Bun.file(path.join(root, manifest)).text())
  await mkdir(root, { recursive: true })
  if ((await lstat(root)).isSymbolicLink())
    throw new Error(`Redcode Desktop cannot install through a directory link: ${root}`)
  if (!entries.length) await Bun.write(path.join(root, manifest), JSON.stringify({ id: identity }))
  // The Windows temp/user profile may use an 8.3 alias; registrations and process paths use the long name.
  return realpath(root)
}

async function powershell(script: string, env: NodeJS.ProcessEnv) {
  await promisify(execFile)(
    path.join(env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { env, windowsHide: true, timeout: 120_000, maxBuffer: 100_000 },
  )
}

const registerScript = String.raw`
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($config.root)
$app = [IO.Path]::GetFullPath($config.app)
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
[IO.Directory]::CreateDirectory($programs) | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $programs 'Redcode.lnk'))
$shortcut.TargetPath = $app
$shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($app)
$shortcut.IconLocation = "$app,0"
$shortcut.Save()
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\RedcodeDesktop')
try {
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $uninstall = '"' + $powershell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'uninstall.ps1') + '"'
  $key.SetValue('DisplayName', 'Redcode')
  $key.SetValue('DisplayVersion', $config.version)
  $key.SetValue('Publisher', 'RedDB')
  $key.SetValue('InstallLocation', $root)
  $key.SetValue('DisplayIcon', "$app,0")
  $key.SetValue('UninstallString', $uninstall)
  $key.SetValue('QuietUninstallString', "$uninstall -Quiet")
  $key.SetValue('URLInfoAbout', 'https://github.com/reddb-io/redcode')
  $key.SetValue('NoModify', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
  $key.SetValue('NoRepair', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
} finally { $key.Dispose() }
$protocol = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\redcode')
try {
  $protocol.SetValue('', 'URL:Redcode')
  $protocol.SetValue('URL Protocol', '')
  $command = $protocol.CreateSubKey('shell\open\command')
  try { $command.SetValue('', '"' + $app + '" "%1"') } finally { $command.Dispose() }
} finally { $protocol.Dispose() }
# Keep running versions intact. A later refresh collects them once their processes exit.
$active = @(Get-CimInstance Win32_Process | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ })
$current = Split-Path (Split-Path $app -Parent) -Parent
Get-ChildItem -LiteralPath (Join-Path $root 'app') -Directory | Where-Object { $_.FullName -ne $current } | ForEach-Object {
  $folder = $_.FullName
  $owner = Join-Path $folder '.redcode-desktop.json'
  if ((Test-Path -LiteralPath $owner) -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    $record = Get-Content -LiteralPath $owner -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($record.id -eq 'io.reddb.redcode' -and -not ($active | Where-Object { $_.StartsWith($folder + '\', [StringComparison]::OrdinalIgnoreCase) })) {
      Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction Continue
    }
  }
}
`

const uninstallScript = String.raw`
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
try {
  $root = [IO.Path]::GetFullPath($PSScriptRoot)
  $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Redcode'))
  if ($root -ne $expected -or ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Refusing to remove a directory outside the Redcode Desktop installation.'
  }
  $owner = Get-Content -LiteralPath (Join-Path $root '.redcode-desktop.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($owner.id -ne 'io.reddb.redcode') { throw 'This directory is not a Redcode Desktop installation.' }
  if (-not $Quiet) {
    $answer = (New-Object -ComObject WScript.Shell).Popup('Uninstall Redcode Desktop and close its running processes? Projects, sessions and settings will be kept.', 0, 'Redcode', 36)
    if ($answer -ne 6) { exit 0 }
  }
  # Match executable paths, never image names such as node.exe or Redcode.exe.
  Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $shortcut = Join-Path $programs 'Redcode.lnk'
  if (Test-Path -LiteralPath $shortcut) {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if ($target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $shortcut -Force }
  }
  $protocol = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\redcode\shell\open\command')
  if ($protocol) {
    try { $command = $protocol.GetValue('') } finally { $protocol.Dispose() }
    if ($command.StartsWith('"' + $root + '\', [StringComparison]::OrdinalIgnoreCase)) {
      [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Classes\redcode', $false)
    }
  }
  $userHome = if ($env:REDCODE_TEST_HOME) { $env:REDCODE_TEST_HOME } else { [Environment]::GetFolderPath('UserProfile') }
  $pointerFile = Join-Path $userHome '.red\code\state\desktop.json'
  if (Test-Path -LiteralPath $pointerFile) {
    $pointer = Get-Content -LiteralPath $pointerFile -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (([string]$pointer.app).StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $pointerFile -Force
    }
  }
  Set-Location -LiteralPath $env:TEMP
  [Environment]::CurrentDirectory = $env:TEMP
  # Windows may need a moment to release Chromium's file handles after termination.
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { Remove-Item -LiteralPath $root -Recurse -Force; break }
    catch { if ($attempt -eq 39) { throw }; Start-Sleep -Milliseconds 250 }
  }
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Microsoft\Windows\CurrentVersion\Uninstall\RedcodeDesktop', $false)
} catch {
  if (-not $Quiet) { (New-Object -ComObject WScript.Shell).Popup($_.Exception.Message, 0, 'Redcode', 16) | Out-Null }
  Write-Error $_
  exit 1
}
`
