export * as WindowsSsh from "./windows"

import { RemoteCli } from "./remote-cli"

// EncodedCommand survives both cmd.exe and PowerShell as the OpenSSH default shell.
export function command(script: string) {
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`
}

const preamble = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
`

const registration = `
$status = (& $cli service status | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $status -eq 'stopped') { exit 0 }
Write-Output ('OPENCODE_SSH_STATUS=' + $status)
foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.red/code/state') -Filter 'service*.json' -ErrorAction SilentlyContinue)) {
  Write-Output 'OPENCODE_SSH_REGISTRATION_BEGIN'
  Get-Content -LiteralPath $file.FullName -Raw
  Write-Output 'OPENCODE_SSH_REGISTRATION_END'
}
`

export const probe = command(`${preamble}
if ($env:OS -ne 'Windows_NT') { exit 2 }
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($arch) {
  'AMD64' { Write-Output 'REDCODE_REMOTE_WINDOWS=windows-x64-baseline' }
  'ARM64' { Write-Output 'REDCODE_REMOTE_WINDOWS=windows-arm64' }
  default { Write-Output 'REDCODE_REMOTE_WINDOWS=unsupported' }
}
`)

export const discover = `${preamble}
$cli = (Get-Command redcode -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (!$cli) {
  $candidate = Join-Path $env:USERPROFILE '.red/code/bin/redcode.exe'
  if (Test-Path -LiteralPath $candidate) { $cli = $candidate }
}
if (!$cli) {
  $cli = Get-ChildItem -Path (Join-Path $env:USERPROFILE '.red/code/desktop-ssh/*/redcode.exe') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (!$cli) { exit 0 }
${registration}`

export function start(version: string, replace: boolean) {
  return `${preamble}
$cli = Join-Path $env:USERPROFILE '.red/code/desktop-ssh/${RemoteCli.requireVersion(version)}/redcode.exe'
& $cli service ${replace ? "restart" : "start"}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
${registration}`
}

export function staged(version: string) {
  return `${preamble}
$destination = Join-Path $env:USERPROFILE '.red/code/desktop-ssh/${RemoteCli.requireVersion(version)}'
if (Test-Path -LiteralPath (Join-Path $destination 'redcode-rpc-sidecar.exe')) {
  $cli = Join-Path $destination 'redcode.exe'
  if (Test-Path -LiteralPath $cli) { & $cli --version }
}
`
}

export function install(target: string, version: string) {
  if (!/^windows-(x64-baseline|arm64)$/.test(target)) throw new RemoteCli.Failure({ code: "platform", detail: target })
  RemoteCli.requireVersion(version)
  const name = `redcode-${target}`
  const url = `https://registry.npmjs.org/@reddb-io/${name}/-/${name}-${version}.tgz`
  return `${preamble}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$destination = Join-Path $env:USERPROFILE '.red/code/desktop-ssh/${version}'
$null = New-Item -ItemType Directory -Path $destination -Force
$stage = Join-Path $destination ('.install-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $stage
try {
  foreach ($url in @('${url}')) {
    $archive = Join-Path $stage 'archive.tgz'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive -TimeoutSec 180
    & tar.exe -xzf $archive -C $stage
    if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed' }
  }
  foreach ($name in @('redcode.exe', 'redcode-rpc-sidecar.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $stage ('package/bin/' + $name)))) { throw 'Incomplete server archive' }
  }
  $actual = (& (Join-Path $stage 'package/bin/redcode.exe') --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or ($actual -split '\\s+')[-1].TrimStart('v') -ne '${version}') { throw 'Server version mismatch' }
  Get-ChildItem -LiteralPath (Join-Path $stage 'package/bin') -File | Move-Item -Destination $destination -Force
} finally {
  # The stage is a fresh child of the fixed version directory, never a caller-supplied path.
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stage)) -ne [IO.Path]::GetFullPath($destination)) { throw 'Invalid staging directory' }
  Remove-Item -LiteralPath $stage -Recurse -Force
}
`
}
