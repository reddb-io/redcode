import { expect, test } from "bun:test"
import { readFile, stat, unlink } from "node:fs/promises"
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { EventKey } from "@opencode/core/event/key"
import { tmpdir } from "./fixture/tmpdir"

test("concurrent key loads use the same protected durable key", async () => {
  await using directory = await tmpdir("redcode-journal-key-")
  const keys = await Promise.all(Array.from({ length: 4 }, () => EventKey.load(directory.path, true)))
  expect(keys.every((key) => key.equals(keys[0]!))).toBe(true)
  expect(keys[0]).toHaveLength(32)
  const file = path.join(directory.path, "event-journal", "key")
  expect((await readFile(file)).equals(keys[0]!)).toBe(true)
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o077).toBe(0)
  else {
    const command = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const script = [
      "$acl = [System.IO.Directory]::GetAccessControl($env:REDCODE_EVENT_KEY_DIRECTORY)",
      "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      "$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])",
      "if (-not $acl.AreAccessRulesProtected -or @($rules | Where-Object { $_.IdentityReference.Value -notin @($user, 'S-1-5-18') }).Count -ne 0) { exit 1 }",
      "$file = [System.IO.File]::GetAccessControl((Join-Path $env:REDCODE_EVENT_KEY_DIRECTORY 'key'))",
      "$rules = $file.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])",
      "if (@($rules | Where-Object { $_.IdentityReference.Value -notin @($user, 'S-1-5-18') }).Count -ne 0) { exit 1 }",
    ].join("\n")
    await promisify(execFile)(command, ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, env: { ...process.env, REDCODE_EVENT_KEY_DIRECTORY: path.dirname(file) },
    })
  }
  expect(await EventKey.load(directory.path, false)).toEqual(keys[0])
  await unlink(file)
  await expect(EventKey.load(directory.path, false)).rejects.toThrow()
}, 30_000)
