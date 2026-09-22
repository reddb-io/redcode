import { spawn } from "node:child_process"
import { Logging } from "@reddb-io/redcode-core/observability/logging"
import { LogFile } from "@reddb-io/redcode-core/observability/log-file"
import { cmd } from "../cmd"

export const LogsCommand = cmd({
  command: "logs",
  describe: "show or open the diagnostic log (10 MiB per file, 5 files retained)",
  builder: (yargs) =>
    yargs
      .option("path", { type: "boolean", describe: "print only the diagnostic log file path" })
      .option("open", { type: "boolean", describe: "open the log with the system file handler" })
      .conflicts("path", "open"),
  async handler(args) {
    const file = Logging.filePath()
    if (args.open) await openLog(file)
    console.log(file)
  },
})

export async function openLog(file = Logging.filePath(), opener: (file: string) => Promise<unknown> = launch) {
  if (!(await LogFile.append(file, []))) throw new Error(`Cannot create diagnostic log: ${file}`)
  await opener(file)
}

export function openerCommand(file: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:REDCODE_LOG_FILE",
      ],
      env: { ...process.env, REDCODE_LOG_FILE: file },
    }
  }
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [file], env: process.env }
}

/** Observe immediate launcher failures, but never wait for or kill the user's editor. */
export function launch(file: string, command = openerCommand(file), graceMs = 500) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, { env: command.env, stdio: "ignore", detached: true })
    const timer = setTimeout(() => {
      child.unref()
      resolve()
    }, graceMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      reject(new Error(`Log file handler failed (${signal ?? code})`))
    })
  })
}
