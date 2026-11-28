import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"
import { invoke, listen } from "../ipc-client"
import { setPinchZoomEnabled, webviewZoom } from "../window/zoom"
import { windowFullscreen } from "../window/fullscreen"
import { DragCancelEvent } from "../../shared/ipc-transport"
import { createExtensionBridge } from "../extensions"
import { createDesktopFiles } from "./files"
import { createDesktopMenuAction } from "./menu"
import { createDesktopNotify } from "./notifications"
import { createDesktopStorage } from "./storage"

export type DesktopWindowState = {
  id: string
  version: string
}

export function createDesktopPlatform(api: ElectronAPI, windowState: DesktopWindowState): Platform {
  const os = desktopOS()

  return {
    platform: "desktop",
    requestMicrophone: () => api.requestMicrophone(),
    os,
    version: windowState.version,
    windowID: windowState.id,
    ...createDesktopFiles(api, os),
    ...createDesktopStorage(api),
    exportDebugLogs: () => api.exportDebugLogs(),
    setForceFocus: (enabled) => api.setForceFocus(enabled),
    recordFatalRendererError: (error) => api.recordFatalRendererError(error),
    restart: async () => api.relaunch(),
    notify: createDesktopNotify(api),
    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)

      return fetch(input, init)
    },
    webviewZoom,
    windowFullscreen,
    onSystemResume: (callback) => listen("SystemResumed", callback),
    setTaskbarState: os === "windows" ? ({ busy, attention, flash, description }) => {
      const overlay = attention > 0 ? taskbarBadge(attention) : undefined
      void invoke("WindowSetTaskbarState", { busy, flash, overlay, description }).catch(() => undefined)
    } : undefined,
    getPinchZoomEnabled: () => api.getPinchZoomEnabled(),
    setPinchZoomEnabled,
    onDragCancel: (callback) => {
      window.addEventListener(DragCancelEvent, callback)

      return () => window.removeEventListener(DragCancelEvent, callback)
    },
    runDesktopMenuAction: createDesktopMenuAction(api),
    checkAppExists: async (appName) => {
      return api.checkAppExists(appName)
    },
    extensions: createExtensionBridge(),
  }
}

function taskbarBadge(count: number) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 32
  const context = canvas.getContext("2d")
  if (!context) return undefined
  context.fillStyle = "#c52248"
  context.beginPath()
  context.arc(16, 16, 16, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = "white"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.font = `bold ${count > 99 ? 13 : 19}px system-ui, sans-serif`
  context.fillText(count > 99 ? "99+" : String(count), 16, 16)
  return canvas.toDataURL("image/png")
}

function desktopOS() {
  if (navigator.userAgent.includes("Mac")) return "macos"

  if (navigator.userAgent.includes("Windows")) return "windows"

  if (navigator.userAgent.includes("Linux")) return "linux"

  return undefined
}
