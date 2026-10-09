import { app } from "electron"
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const WINDOW_IDS_KEY = "windowIds"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"

type Values = Record<string, unknown>

let cache: Values | undefined

// The file is resolved lazily because `userData` is only final after `app.setPath` runs at startup.
function file() {
  return join(app.getPath("userData"), "settings.json")
}

function load() {
  if (cache) return cache
  cache = existsSync(file()) ? parse(readFileSync(file(), "utf8")) : {}
  return cache
}

function parse(text: string): Values {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Values) : {}
  } catch {
    return {}
  }
}

export function getSetting(key: string) {
  return load()[key]
}

export function setSetting(key: string, value: unknown) {
  const next = { ...load() }
  if (value === undefined || value === null) delete next[key]
  else next[key] = value
  cache = next
  // Write to a sibling and rename so a crash never leaves a half-written settings file.
  const temp = `${file()}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2))
  renameSync(temp, file())
}
