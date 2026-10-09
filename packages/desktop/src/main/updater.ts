import { app, dialog } from "electron"
import electronUpdater from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { write as writeLog } from "./logging"
import { nativeT } from "./native-translations"
import { getSetting, setSetting } from "./store"
import { createUpdaterController } from "./updater-controller"
import { setAppQuitting } from "./windows"

const { autoUpdater } = electronUpdater
const READY_KEY = "updaterReady"

export function setupAutoUpdater(stop: () => Promise<void>) {
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => {
        // quitAndInstall closes every window before before-quit, so flag the quit first to keep window ids for restore.
        setAppQuitting()
        try {
          autoUpdater.quitAndInstall()
        } catch (error) {
          // The install failed and the app keeps running, so deliberate window closes must prune ids again.
          setAppQuitting(false)
          throw error
        }
      },
    },
    persistence: {
      get() {
        const value = getSetting(READY_KEY)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version }
      },
      set: (value) => setSetting(READY_KEY, value),
      clear: () => setSetting(READY_KEY, undefined),
    },
    stop,
    log: (message, data) => writeLog("updater", message, data),
  })
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupAutoUpdater>, alertOnFail: boolean) {
  const state = await controller.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message"),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.ready.title"),
    buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await controller.install()
}
