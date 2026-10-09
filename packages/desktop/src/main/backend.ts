import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import type { Logger } from "./logging"

const execFileAsync = promisify(execFile)

export type BackendEndpoint = {
  url: string
  username: string
  password: string
}

/**
 * Connects to the Redcode background service, starting it when needed. The service is the same one the
 * terminal client uses, so sessions started in either client show up in both.
 */
export async function startBackend(logger: Logger): Promise<BackendEndpoint> {
  const override = process.env.REDCODE_DESKTOP_SERVER_URL
  if (override) {
    logger.log("backend override in use", { url: override })
    return { url: override, username: "opencode", password: process.env.REDCODE_DESKTOP_SERVER_PASSWORD ?? "" }
  }

  const binary = await resolveBinary(logger)
  const url = await run(binary, ["service", "start"], logger)
  if (!URL.canParse(url)) throw new Error(`The Redcode service reported an unusable address: ${url}`)
  const password = await run(binary, ["service", "get", "password"], logger, { redact: true })
  logger.log("backend ready", { url })
  return { url, username: "opencode", password }
}

async function resolveBinary(logger: Logger) {
  if (!app.isPackaged) return process.env.REDCODE_BIN ?? executableName()

  const bundled = join(process.resourcesPath, executableName())
  const version = await run(bundled, ["--version"], logger)
  return stageBinary(bundled, version, logger)
}

// The service keeps running after the app quits. Staging the executable under userData keeps its path valid
// when an app update replaces the bundled resources, and lets Windows replace the installed files.
async function stageBinary(source: string, version: string, logger: Logger) {
  const directory = join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = join(directory, executableName())
  if (existsSync(destination)) return destination

  const temp = `${destination}.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await copyFile(source, temp)
  if (process.platform !== "win32") await chmod(temp, 0o755)
  await rename(temp, destination).catch(async (error) => {
    await rm(temp, { force: true })
    throw error
  })
  logger.log("backend executable staged", { source, destination, version })
  return destination
}

async function run(binary: string, args: string[], logger: Logger, options: { redact?: boolean } = {}) {
  logger.log("backend command started", { binary, args })
  return execFileAsync(binary, args, { windowsHide: true, timeout: 60_000 }).then(
    (result) => {
      const stdout = result.stdout.trim()
      logger.log("backend command completed", { args, stdout: options.redact ? "[redacted]" : stdout })
      return stdout
    },
    (error: { message?: string; stderr?: string }) => {
      logger.error("backend command failed", { args, message: error.message, stderr: error.stderr?.trim() })
      throw error
    },
  )
}

function executableName() {
  return process.platform === "win32" ? "redcode.exe" : "redcode"
}
