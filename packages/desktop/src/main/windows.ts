import windowState from "electron-window-state"
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { app, BrowserWindow, dialog, nativeImage, nativeTheme, net, protocol, shell } from "electron"
import type { TitlebarTheme } from "../preload/types"
import { resolveExternalURL, resolveLocalFilePath } from "./external-url"
import { logFilePath, write as writeLog } from "./logging"
import { nativeT } from "./native-translations"
import { getSetting, PINCH_ZOOM_ENABLED_KEY, setSetting, WINDOW_IDS_KEY } from "./store"
import { createWindowRegistry } from "./window-registry"
import { safeWindowURL } from "./window-state"

const root = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(root, "../renderer")
const rendererProtocol = "redcode-app"
const rendererHost = "renderer"
const rendererPermissions = new Set(["clipboard-sanitized-write", "notifications"])
// Used until the renderer reports its resolved theme background, so the first paint matches the system mode.
const fallbackBackground = { light: "#f8f7f7", dark: "#101010" }
const titlebarHeight = 40
const maxZoomLevel = 10
const minZoomLevel = 0.2

protocol.registerSchemesAsPrivileged([
  { scheme: rendererProtocol, privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
])

let backgroundColor: string | undefined
let relaunchHandler = () => {
  setAppQuitting()
  app.relaunch()
  app.exit(0)
}
const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()
const pinchZoomEnabled = new WeakMap<BrowserWindow, boolean>()
const windowIDs = new WeakMap<BrowserWindow, string>()
const registry = createWindowRegistry<BrowserWindow>({
  read: () => getSetting(WINDOW_IDS_KEY),
  write: (ids) => setSetting(WINDOW_IDS_KEY, ids),
  // Window geometry is the only main-process state tied to a window id; renderer state lives in its own storage.
  cleanup: (id) => rmSync(join(app.getPath("userData"), windowStateFile(id)), { force: true }),
})

export function setRelaunchHandler(handler: () => void) {
  relaunchHandler = handler
}

export function setAppQuitting(quitting = true) {
  registry.setQuitting(quitting)
}

export function setBackgroundColor(color: string) {
  backgroundColor = color
  BrowserWindow.getAllWindows().forEach((win) => {
    win.setBackgroundColor(color)
    if (process.platform === "darwin") win.invalidateShadow()
  })
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  titlebarThemes.set(win, theme)
  // macOS draws the window frame hairline and shadow from the NSWindow appearance, which follows nativeTheme.
  // A "system" scheme must stay "system" so prefers-color-scheme keeps tracking OS appearance changes.
  if (process.platform === "darwin") nativeTheme.themeSource = theme.scheme ?? theme.mode ?? "system"
  updateTitlebar(win)
}

export function updateTitlebar(win: BrowserWindow) {
  if (process.platform !== "win32") return
  win.setTitleBarOverlay(overlay(titlebarThemes.get(win), win.webContents.getZoomFactor()))
}

export function getPinchZoomEnabled() {
  return getSetting(PINCH_ZOOM_ENABLED_KEY) === true
}

export function setPinchZoomEnabled(enabled: boolean) {
  setSetting(PINCH_ZOOM_ENABLED_KEY, enabled)
  for (const win of BrowserWindow.getAllWindows()) {
    pinchZoomEnabled.set(win, enabled)
    win.webContents.send("pinch-zoom-enabled-changed", enabled)
    if (!enabled && win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  }
}

export function getWindowID(win: BrowserWindow) {
  return windowIDs.get(win)
}

export function getLastFocusedWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) return focused
  const win = registry.lastFocused()
  if (!win || win.isDestroyed()) return null
  return win
}

export function restoreMainWindows() {
  const ids = registry.persisted()
  return (ids.length ? ids : [randomUUID()]).map((id) => createMainWindow(id))
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(iconPath())
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow(id: string = randomUUID()) {
  const state = windowState({ file: windowStateFile(id), defaultWidth: 1280, defaultHeight: 800 })
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    autoHideMenuBar: true,
    title: "Redcode",
    icon: iconPath(),
    backgroundColor: backgroundColor ?? fallbackBackground[tone()],
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    ...(process.platform === "win32"
      ? { frame: false, titleBarStyle: "hidden" as const, titleBarOverlay: overlay({ mode: tone() }) }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  allowRendererPermissions(win)
  wireWindowRecovery(win, id)
  wireNavigationPolicy(win)

  // The renderer talks to servers on other origins (the local service, remote servers), so answer for them.
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders = {} } = details
    upsertHeader(responseHeaders, "Access-Control-Allow-Origin", ["*"])
    upsertHeader(responseHeaders, "Access-Control-Allow-Headers", ["*"])
    callback({ responseHeaders })
  })

  state.manage(win)
  registerWindow(win, id)
  wireFullscreen(win)
  loadWindow(win)
  wireZoom(win)

  win.once("ready-to-show", () => win.show())
  return win
}

export function openExternalURL(value: string) {
  const url = resolveExternalURL(value)
  if (!url) return writeLog("window", "blocked external target", { url: value }, "warn")
  void shell.openExternal(url)
}

export function openLocalFileURL(value: string) {
  const path = resolveLocalFilePath(value)
  if (!path) return writeLog("window", "blocked local file target", { url: value }, "warn")
  void shell.openPath(path).then((error) => {
    if (error) writeLog("window", "failed to open local file", { path, error }, "error")
  })
}

export function registerRendererProtocol() {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url)
    if (url.host !== rendererHost) {
      writeLog("protocol", "rejected host", { url: request.url }, "warn")
      return new Response("Not found", { status: 404 })
    }

    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(rendererRoot, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      writeLog("protocol", "rejected path", { url: request.url, file }, "warn")
      return new Response("Not found", { status: 404 })
    }

    const range = request.headers.get("range")
    return net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined }).catch((error) => {
      writeLog("protocol", "fetch error", { url: request.url, file, error }, "error")
      return new Response("Not found", { status: 404 })
    })
  })
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  return join(iconsDir(), "icon.png")
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function overlay(theme: Partial<TitlebarTheme> = {}, zoom = 1) {
  return {
    color: "#00000000",
    symbolColor: (theme.mode ?? tone()) === "dark" ? "white" : "black",
    height: Math.max(titlebarHeight, Math.round(titlebarHeight * zoom)),
  }
}

function windowStateFile(id: string) {
  return `window-state-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

function registerWindow(win: BrowserWindow, id: string) {
  windowIDs.set(win, id)
  registry.register(id, win)

  win.on("focus", () => registry.focused(id))
  // Windows never emits before-quit on OS shutdown or logoff, but each window gets session-end before it closes.
  win.on("session-end", () => registry.setQuitting())
  win.on("closed", () => registry.closed(id))
}

function loadWindow(win: BrowserWindow) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  void win.loadURL(
    devUrl ? new URL("index.html", devUrl).toString() : `${rendererProtocol}://${rendererHost}/index.html`,
  )
}

function wireNavigationPolicy(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isRendererUrl(url)) openExternalURL(url)
    return { action: "deny" }
  })
  // Reloads navigate to the app's own URL and stay in the window; everything else leaves through the OS.
  win.webContents.on("will-navigate", (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    openExternalURL(url)
  })
}

function allowRendererPermissions(win: BrowserWindow) {
  const webContentsId = win.webContents.id

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      rendererPermissions.has(permission) && isRendererUrl(details.requestingUrl) && webContents.id === webContentsId,
    )
  })
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!rendererPermissions.has(permission)) return false
    if (webContents && webContents.id !== webContentsId) return false
    return isRendererUrl(details.requestingUrl) || isRendererUrl(requestingOrigin)
  })
}

function isRendererUrl(value?: string) {
  if (!value || !URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol === `${rendererProtocol}:` && url.host === rendererHost) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  return !!devUrl && URL.canParse(devUrl) && url.origin === new URL(devUrl).origin
}

function wireWindowRecovery(win: BrowserWindow, name: string) {
  let showing = false

  type Action = "relaunch" | "logs" | "wait" | "quit"
  const show = async (message: string, detail: string, canWait: boolean) => {
    if (showing || win.isDestroyed()) return
    showing = true
    const actions: { id: Action; label: string }[] = [
      { id: "relaunch", label: nativeT("desktop.recovery.action.relaunch") },
      { id: "logs", label: nativeT("desktop.recovery.action.exportLogs") },
      canWait
        ? { id: "wait", label: nativeT("desktop.recovery.action.keepWaiting") }
        : { id: "quit", label: nativeT("desktop.recovery.action.quit") },
    ]
    const result = await dialog
      .showMessageBox(win, {
        type: "warning",
        buttons: actions.map((action) => action.label),
        defaultId: 0,
        cancelId: 2,
        message,
        detail,
      })
      .finally(() => {
        showing = false
      })
    const action = actions[result.response]?.id
    if (action === "relaunch") relaunchHandler()
    if (action === "quit") app.quit()
    if (action === "logs") shell.showItemInFolder(logFilePath())
  }

  const failed = (errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
    writeLog(
      "window",
      "renderer load failed",
      { window: name, errorCode, errorDescription, validatedURL, currentURL: safeWindowURL(win), isMainFrame },
      "error",
    )
    // -3 is a navigation aborted by a newer navigation, which is not a failure.
    if (!isMainFrame || errorCode === -3) return
    void show(
      nativeT("desktop.recovery.loadFailed"),
      nativeT("desktop.recovery.loadFailed.detail", {
        window: name,
        url: validatedURL,
        code: errorCode,
        description: errorDescription,
      }),
      false,
    )
  }

  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) =>
    failed(code, description, url, isMainFrame),
  )
  win.webContents.on("did-fail-provisional-load", (_event, code, description, url, isMainFrame) =>
    failed(code, description, url, isMainFrame),
  )
  win.webContents.on("render-process-gone", (_event, details) => {
    writeLog("window", "renderer process gone", { window: name, currentURL: safeWindowURL(win), details }, "error")
    void show(
      nativeT("desktop.recovery.terminated"),
      nativeT("desktop.recovery.terminated.detail", {
        window: name,
        reason: details.reason,
        code: details.exitCode ?? nativeT("desktop.recovery.unknown"),
      }),
      false,
    )
  })
  win.on("unresponsive", () => {
    writeLog("window", "renderer unresponsive", { window: name, currentURL: safeWindowURL(win) }, "error")
    void show(nativeT("desktop.recovery.unresponsive"), nativeT("desktop.recovery.unresponsive.detail"), true)
  })
  win.on("responsive", () => writeLog("window", "renderer responsive", { window: name }))
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeLog("preload", "preload error", { window: name, preloadPath, error }, "error")
  })
}

function wireZoom(win: BrowserWindow) {
  pinchZoomEnabled.set(win, getPinchZoomEnabled())
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", (event, zoomDirection) => {
    event.preventDefault()
    if (pinchZoomEnabled.get(win)) {
      win.webContents.setZoomFactor(clampZoom(win.webContents.getZoomFactor() + (zoomDirection === "in" ? 0.2 : -0.2)))
      updateZoom(win)
      return
    }
    if (win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  })
}

function wireFullscreen(win: BrowserWindow) {
  const send = (fullscreen: boolean) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send("window-fullscreen-changed", fullscreen)
  }

  win.on("enter-full-screen", () => send(true))
  win.on("leave-full-screen", () => send(false))
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, minZoomLevel), maxZoomLevel)
}

function updateZoom(win: BrowserWindow) {
  updateTitlebar(win)
  win.webContents.send("zoom-factor-changed", win.webContents.getZoomFactor())
}

function upsertHeader(headers: Record<string, string[]>, name: string, value: string[]) {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  headers[existing ?? name] = value
}
