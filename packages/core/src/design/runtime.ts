export * as DesignRuntime from "./runtime.js"

import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { importModule } from "#design-import"
import { Npm } from "@opencode/util/npm"

declare const REDCODE_DESIGN_RUNTIME: boolean

// These packages load native libraries, executables and browser scripts relative
// to their package directories. They must remain real packages in a native CLI.
export const versions = {
  vite: "7.1.4",
  "@vitejs/plugin-react": "4.7.0",
  "vite-plugin-solid": "2.11.10",
  "playwright-core": "1.59.1",
  "@axe-core/playwright": "4.13.0",
} as const

type Modules = {
  vite: typeof import("vite")
  "@vitejs/plugin-react": typeof import("@vitejs/plugin-react")
  "vite-plugin-solid": typeof import("vite-plugin-solid")
  "playwright-core": typeof import("playwright-core")
  "@axe-core/playwright": typeof import("@axe-core/playwright")
}

const installs = { active: 0 }

/** Whether the Design tools are being installed now, as they are the first time a compiled redcode needs them. */
export function installing() {
  return installs.active > 0
}

export async function resolve(name: keyof Modules, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (typeof REDCODE_DESIGN_RUNTIME === "undefined") {
    try {
      return createRequire(import.meta.url).resolve(name)
    } catch {
      // Published Core packages may not have development-only Design tools installed.
    }
  }
  installs.active++
  const installed = await Npm.add(`${name}@${versions[name]}`).finally(() => installs.active--)
  signal?.throwIfAborted()
  return createRequire(`${installed.directory}/package.json`).resolve(name)
}

export async function load<K extends keyof Modules>(name: K, signal?: AbortSignal): Promise<Modules[K]> {
  // A variable file URL keeps Bun from bundling path-sensitive dependencies.
  const file = pathToFileURL(await resolve(name, signal)).href
  // Babel installs an Error.prepareStackTrace that delegates to Bun's native default for the life
  // of the process (vite-plugin-solid and the TUI's solid transform run it), and that default
  // rejects the pseudo-Error instances Vite's bundled follow-redirects constructs while its chunk
  // evaluates; so does Bun when the property is absent. A plain formatter stands in for the import
  // and the original descriptor is restored afterwards.
  const hook = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace")
  Error.prepareStackTrace = (error, trace) => [String(error), ...trace.map((frame) => `    at ${frame}`)].join("\n")
  return importModule<Modules[K]>(file).finally(() => {
    if (hook) Object.defineProperty(Error, "prepareStackTrace", hook)
  })
}
