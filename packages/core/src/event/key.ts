export * as EventKey from "./key.js"

import { randomBytes } from "node:crypto"
import { execFile } from "node:child_process"
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

/** Creates the key only in an owner-restricted directory and publishes it atomically. */
export async function load(data: string, create: boolean): Promise<Buffer> {
  const directory = path.join(data, "event-journal")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform === "win32") {
    const system = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32")
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$acl = New-Object System.Security.AccessControl.DirectorySecurity",
      "$acl.SetAccessRuleProtection($true, $false)",
      "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
      "$system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')",
      "foreach ($identity in @($user, $system)) {",
      "  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')",
      "  $acl.AddAccessRule($rule)",
      "}",
      "[System.IO.Directory]::SetAccessControl($env:REDCODE_EVENT_KEY_DIRECTORY, $acl)",
    ].join("\n")
    await exec(path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, env: { ...process.env, REDCODE_EVENT_KEY_DIRECTORY: directory } },
    )
  } else await chmod(directory, 0o700)

  const filename = path.join(directory, "key")
  let key = await readFile(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && create) return undefined
    throw error
  })
  if (!key) {
    const temporary = path.join(directory, `key-${randomBytes(16).toString("hex")}`)
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(randomBytes(32))
      await handle.sync()
      await handle.close()
      await link(temporary, filename).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error
      })
    } finally {
      await handle.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
    }
    key = await readFile(filename)
  }
  if (process.platform !== "win32") await chmod(filename, 0o600)
  if (key.length !== 32) throw new Error("Invalid event journal key")
  return key
}
