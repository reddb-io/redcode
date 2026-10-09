import { homedir } from "node:os"
import { join } from "node:path"
import { app, BrowserWindow } from "electron"
import { checkAppExists, resolveAppPath } from "./apps"
import { startBackend, type BackendEndpoint } from "./backend"
import { APP_IDS, APP_NAMES, CHANNEL } from "./constants"
import { registerIpcHandlers, sendMenuCommand } from "./ipc"
import { exportDebugLogs, initLogging, write as writeLog } from "./logging"
import { createMenu } from "./menu"
import { setNativeTranslations } from "./native-translations"
import { loadShellEnv } from "./shell-env"
import { DEFAULT_SERVER_URL_KEY, getSetting, setSetting } from "./store"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  restoreMainWindows,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  setRelaunchHandler,
} from "./windows"

const appId = app.isPackaged ? APP_IDS[CHANNEL] : APP_IDS.dev

app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : APP_NAMES.dev)
app.setAppUserModelId(appId)
// REDCODE_DESKTOP_USER_DATA lets several development instances run side by side (the single-instance lock is per profile).
app.setPath("userData", process.env.REDCODE_DESKTOP_USER_DATA ?? join(app.getPath("appData"), appId))

const logger = initLogging()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void main()
}

async function main() {
  // Apps started from a launcher run in `/`, which breaks tools that scan the working directory (ripgrep).
  process.chdir(homedir())
  keepLoopbackDirect()
  app.commandLine.appendSwitch("ozone-platform-hint", "auto")
  if (!app.isPackaged)
    app.commandLine.appendSwitch("remote-debugging-port", process.env.REDCODE_DESKTOP_DEBUG_PORT ?? "9222")

  logger.log("app starting", { version: app.getVersion(), packaged: app.isPackaged, channel: CHANNEL })

  app.on("second-instance", () => {
    const win = getLastFocusedWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  app.on("before-quit", () => setAppQuitting())
  app.on("child-process-gone", (_event, details) => writeLog("utility", "child process gone", { details }, "error"))
  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) restoreMainWindows()
  })
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      app.quit()
    })
  }

  await app.whenReady()

  // Resolved lazily so the renderer can paint a splash while the service starts. The promise is created once and
  // shared by every window, and a failure is reported to the renderer through the rejected IPC call.
  loadShellEnv()
  const backend: Promise<BackendEndpoint> = startBackend(logger)
  backend.catch((error) => logger.error("backend failed to start", error))

  const relaunch = () => {
    setAppQuitting()
    app.relaunch()
    app.quit()
  }
  setRelaunchHandler(relaunch)
  registerRendererProtocol()
  setDockIcon()

  // The service outlives the window and is shared with the terminal client, so quitting never stops it.
  const updater = setupAutoUpdater(async () => undefined)
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater, true),
    relaunch,
  }
  registerIpcHandlers({
    killSidecar: () => undefined,
    relaunch,
    awaitInitialization: () => backend,
    getDefaultServerUrl: () => {
      const value = getSetting(DEFAULT_SERVER_URL_KEY)
      return typeof value === "string" ? value : null
    },
    setDefaultServerUrl: (url) => setSetting(DEFAULT_SERVER_URL_KEY, url),
    checkAppExists,
    resolveAppPath,
    updater,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor,
    exportDebugLogs,
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) createMenu(menuDeps)
    },
  })

  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()

  restoreMainWindows()
  createMenu(menuDeps)
}

// A system proxy must never intercept the local service.
function keepLoopbackDirect() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  for (const key of ["NO_PROXY", "no_proxy"]) {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    process.env[key] = [
      ...items,
      ...loopback.filter((host) => !items.some((item) => item.toLowerCase() === host)),
    ].join(",")
  }
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
}
