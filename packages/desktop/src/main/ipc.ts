import { execFile } from "node:child_process"
import { stat, writeFile } from "node:fs/promises"
import { basename } from "node:path"
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { DesktopMenuAction } from "@opencode/app/desktop-menu"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode/app/i18n/desktop-native"
import type { FatalRendererError, ServerReadyData, TitlebarTheme } from "../preload/types"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { nativeT } from "./native-translations"
import type { UpdaterController } from "./updater-controller"
import { createUpdaterSubscriptions } from "./updater-subscriptions"
import {
  getPinchZoomEnabled,
  getWindowID,
  openExternalURL,
  openLocalFileURL,
  setPinchZoomEnabled,
  setTitlebar,
  updateTitlebar,
} from "./windows"

type Deps = {
  killSidecar: () => Promise<void> | void
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  getDefaultServerUrl: () => string | null
  setDefaultServerUrl: (url: string | null) => void
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null> | string | null
  updater: UpdaterController
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

const pickedFiles = createPickedFileAuthorizations()

export function registerIpcHandlers(deps: Deps) {
  const updaterSubscriptions = createUpdaterSubscriptions()
  const windowOf = (event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender)

  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("await-initialization", () => deps.awaitInitialization())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event, url: string | null) => deps.setDefaultServerUrl(url))
  ipcMain.handle("check-app-exists", (_event, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("resolve-app-path", (_event, appName: string) => deps.resolveAppPath(appName))

  ipcMain.handle("updater-subscribe", (event) => {
    const id = event.sender.id
    updaterSubscriptions.set(
      id,
      deps.updater.subscribe((state) => {
        if (event.sender.isDestroyed()) return updaterSubscriptions.delete(id)
        event.sender.send("updater-state", state)
      }),
    )
    event.sender.once("destroyed", () => updaterSubscriptions.delete(id))
  })
  ipcMain.handle("updater-unsubscribe", (event) => updaterSubscriptions.delete(event.sender.id))
  ipcMain.handle("updater-check", () => deps.updater.check())
  ipcMain.handle("updater-install", () => deps.updater.install())

  ipcMain.handle("set-background-color", (_event, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("export-debug-logs", () => deps.exportDebugLogs())
  ipcMain.handle("record-fatal-renderer-error", (_event, error: FatalRendererError) =>
    deps.recordFatalRendererError(error),
  )
  ipcMain.handle("set-native-translations", (event, value: unknown) => {
    const win = windowOf(event)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Invalid native translation sender")
    }
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFolder"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (event, opts?: { multiple?: boolean; title?: string; defaultPath?: string; extensions?: string[] }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFile"),
        defaultPath: opts?.defaultPath,
        filters: opts?.extensions?.length
          ? [{ name: nativeT("desktop.dialog.files"), extensions: opts.extensions }]
          : undefined,
      })
      if (result.canceled) return null
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => ({
          path: filePath,
          name: basename(filePath),
          size: (await stat(filePath)).size,
        })),
      )
      assertAttachmentBudget(files)
      return { token: pickedFiles.add(event.sender.id, result.filePaths), files }
    },
  )
  ipcMain.handle("read-picked-file", (event, token: string, filePath: string) =>
    pickedFiles.read(event.sender.id, token, filePath),
  )
  ipcMain.handle("release-picked-files", (event, token: string) => pickedFiles.release(event.sender.id, token))
  ipcMain.handle(
    "save-file",
    async (_event, opts: { title?: string; defaultPath?: string } | undefined, content: string) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? nativeT("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, content)
      return true
    },
  )

  ipcMain.on("open-external", (_event: IpcMainEvent, url: string) => openExternalURL(url))
  ipcMain.on("open-local-file", (_event: IpcMainEvent, url: string) => openLocalFileURL(url))
  ipcMain.handle("open-path", async (_event, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })
  ipcMain.handle("reveal-path", async (_event, path: string) => {
    const exists = await stat(path).then(
      () => true,
      () => false,
    )
    if (exists) shell.showItemInFolder(path)
    return exists
  })
  ipcMain.handle("read-clipboard-image", async () => {
    const item = (await clipboard.read()).find((entry) => entry.types.includes("image/png"))
    if (!item) return null
    const buffer = await ((await item.getType("image/png")) as Blob).arrayBuffer()
    return { buffer, ...nativeImage.createFromBuffer(Buffer.from(buffer)).getSize() }
  })

  ipcMain.handle("get-window-id", (event) => {
    const win = windowOf(event)
    if (!win) throw new Error("Window not found")
    const id = getWindowID(win)
    if (!id) throw new Error("Window ID not found")
    return id
  })
  ipcMain.handle("get-window-focused", (event) => windowOf(event)?.isFocused() ?? false)
  ipcMain.handle("get-window-fullscreen", (event) => windowOf(event)?.isFullScreen() ?? false)
  ipcMain.handle("set-window-focus", (event) => windowOf(event)?.focus())
  ipcMain.handle("show-window", (event) => windowOf(event)?.show())
  ipcMain.on("relaunch", () => deps.relaunch())

  ipcMain.handle("get-zoom-factor", (event) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = windowOf(event)
    if (win) updateTitlebar(win)
  })
  ipcMain.handle("get-pinch-zoom-enabled", () => getPinchZoomEnabled())
  ipcMain.handle("set-pinch-zoom-enabled", (_event, enabled: boolean) => setPinchZoomEnabled(enabled))
  ipcMain.handle("set-titlebar", (event, theme: TitlebarTheme) => {
    const win = windowOf(event)
    if (win) setTitlebar(win, theme)
  })
  ipcMain.handle("run-desktop-menu-action", (event, action: DesktopMenuAction) => {
    runDesktopMenuAction(windowOf(event), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })

  return { dispose: updaterSubscriptions.clear }
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}
