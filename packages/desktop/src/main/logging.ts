import { app, shell } from "electron"
import log from "electron-log/main.js"

type Level = "info" | "warn" | "error"

export function initLogging() {
  log.initialize()
  log.transports.file.level = "info"
  log.transports.console.level = app.isPackaged ? false : "debug"
  log.errorHandler.startCatching({ showDialog: false })
  return {
    log: (message: string, meta?: unknown) => log.info(message, meta ?? ""),
    warn: (message: string, meta?: unknown) => log.warn(message, meta ?? ""),
    error: (message: string, meta?: unknown) => log.error(message, meta ?? ""),
  }
}

export type Logger = ReturnType<typeof initLogging>

export function write(scope: string, message: string, meta?: unknown, level: Level = "info") {
  log[level](`[${scope}] ${message}`, meta ?? "")
}

export function logFilePath() {
  return log.transports.file.getFile().path
}

/** Reveals the log file so it can be attached to a bug report. */
export async function exportDebugLogs() {
  const path = logFilePath()
  shell.showItemInFolder(path)
  return path
}
