// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  AppBaseProviders,
  AppInterface,
  loadInitialLocale,
  PlatformProvider,
  ServerConnection,
  useCommand,
  useLanguage,
  type Platform,
  type UpdaterState,
} from "@opencode/app/desktop"
import { useTheme } from "@opencode/ui/theme/context"
import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { api } from "./api"
import { initializationData } from "./initialization"
import { resetZoom, setPinchZoomEnabled, webviewZoom, zoomIn, zoomOut } from "./webview-zoom"
import { windowFullscreen } from "./window-fullscreen"
import "./styles.css"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element not found. Did you forget to add it to index.html?")
}

const [updaterState, setUpdaterState] = createSignal<UpdaterState>({ status: "disabled" })
void api.updater.subscribe(setUpdaterState)

let menuTrigger: undefined | ((id: string) => void)
api.onMenuCommand((id) => menuTrigger?.(id))

function lastActiveUrlKey(windowID: string) {
  return `redcode.desktop.window.${windowID}.last-active-url`
}

function getLastActiveUrl(windowID: string) {
  try {
    const value = localStorage.getItem(lastActiveUrlKey(windowID))
    if (value?.startsWith("/") && !value.startsWith("//")) return value
  } catch {}
  return "/"
}

// Each window restores the route it was showing when it closed.
function DesktopMemoryRouter(props: BaseRouterProps & { windowID: string }) {
  const history = createMemoryHistory()
  const initialUrl = getLastActiveUrl(props.windowID)
  if (initialUrl !== "/") history.set({ value: initialUrl, replace: true, scroll: false })
  onCleanup(
    history.listen((value) => {
      try {
        localStorage.setItem(lastActiveUrlKey(props.windowID), value)
      } catch {}
    }),
  )
  return <MemoryRouter {...props} history={history} />
}

const os = (() => {
  const ua = navigator.userAgent
  if (ua.includes("Mac")) return "macos"
  if (ua.includes("Windows")) return "windows"
  if (ua.includes("Linux")) return "linux"
  return undefined
})()

function createPlatform(windowID: string): Platform {
  const attachmentPaths = new WeakMap<File, string>()

  return {
    platform: "desktop",
    os,
    version: pkg.version,
    windowID,

    async openDirectoryPickerDialog(opts) {
      return api.openDirectoryPicker({ multiple: opts?.multiple ?? false, title: opts?.title })
    },

    async openAttachmentPickerDialog(opts, onFile) {
      const result = await api.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title,
        defaultPath: opts?.defaultPath,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      if (!result) return
      try {
        for (const file of result.files) {
          const selected = new File([await api.readPickedFile(result.token, file.path)], file.name)
          attachmentPaths.set(selected, file.path)
          await onFile(selected)
        }
      } finally {
        await api.releasePickedFiles(result.token)
      }
    },

    getPathForFile: (file) => attachmentPaths.get(file) ?? api.getPathForFile(file),

    saveFile: (opts, content) => api.saveFile({ title: opts.title, defaultPath: opts.defaultPath }, content),

    openExternal: (url) => api.openExternal(url),
    openLocalFile: (url) => api.openLocalFile(url),
    async openPath(path, app) {
      if (os !== "windows") return api.openPath(path, app)
      const resolved = app ? await api.resolveAppPath(app).catch(() => null) : null
      return api.openPath(path, resolved ?? undefined)
    },
    revealPath: (path) => api.revealPath(path),

    updater: {
      state: updaterState,
      check: () => api.updater.check(),
      install: () => api.updater.install(),
    },

    exportDebugLogs: () => api.exportDebugLogs(),
    recordFatalRendererError: (error) => api.recordFatalRendererError(error),

    restart: async () => {
      await api.killSidecar().catch(() => undefined)
      api.relaunch()
    },

    notify: async (title, description, onClick) => {
      const focused = await api.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, { body: description ?? "" })
      notification.onclick = () => {
        void api.showWindow()
        void api.setWindowFocus()
        onClick?.()
        notification.close()
      }
    },

    getDefaultServer: async () => {
      const url = await api.getDefaultServerUrl().catch(() => null)
      return url ? ServerConnection.Key.make(url) : null
    },
    setDefaultServer: (url) => api.setDefaultServerUrl(url),

    webviewZoom,
    windowFullscreen,
    getPinchZoomEnabled: () => api.getPinchZoomEnabled(),
    setPinchZoomEnabled,

    runDesktopMenuAction: (action) => {
      if (action === "view.resetZoom") return resetZoom()
      if (action === "view.zoomIn") return zoomIn()
      if (action === "view.zoomOut") return zoomOut()
      return api.runDesktopMenuAction(action)
    },

    checkAppExists: (appName) => api.checkAppExists(appName),

    async readClipboardImage() {
      const image = await api.readClipboardImage().catch(() => null)
      if (!image) return null
      return new File([new Blob([image.buffer], { type: "image/png" })], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
  }
}

function LoadingSplash() {
  return <div class="h-dvh w-screen bg-v2-background-bg-deep" />
}

function DesktopRoot(props: { windowID: string }) {
  const platform = createPlatform(props.windowID)
  // The service credentials are available as soon as it is listening, before any health check.
  const [backend] = createResource(() => api.awaitInitialization())
  const [defaultServer] = createResource(() => platform.getDefaultServer?.())
  const [locale] = createResource(loadInitialLocale)
  const router = (routerProps: BaseRouterProps) => <DesktopMemoryRouter {...routerProps} windowID={props.windowID} />

  // Mirrors the resolved theme background into the native window so resizing never flashes the wrong color.
  function ThemeBackground() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)
    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) void api.setBackgroundColor(bg)
    })
    return null
  }

  function App() {
    const language = useLanguage()
    const ready = createMemo(() => !defaultServer.loading && !backend.loading && !locale.loading)
    const servers = createMemo(() => {
      const data = initializationData(backend)
      if (!data) return []
      return [
        {
          displayName: language.t("desktop.server.local"),
          type: "sidecar",
          variant: "base",
          http: { url: data.url, password: data.password ?? undefined },
        } satisfies ServerConnection.Any,
      ]
    })
    const initialServer = createMemo(() => ServerConnection.Key.make(defaultServer.latest ?? "sidecar"))

    return (
      <Show when={ready()} fallback={<LoadingSplash />}>
        <Show when={initialServer()} keyed>
          {(key) => (
            <AppInterface defaultServer={key} servers={servers()} router={router}>
              <ThemeBackground />
            </AppInterface>
          )}
        </Show>
      </Show>
    )
  }

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders
        locale={locale.latest}
        onNativeTranslations={(bundle) => void api.setNativeTranslations(bundle).catch(() => undefined)}
      >
        <App />
      </AppBaseProviders>
    </PlatformProvider>
  )
}

render(() => {
  const [windowID] = createResource(() => api.getWindowID())
  return (
    <Show when={windowID.latest} fallback={<LoadingSplash />} keyed>
      {(id) => <DesktopRoot windowID={id} />}
    </Show>
  )
}, root!)
