export * as DesignRuntime from "./runtime"

import path from "node:path"
import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { Global } from "../global"
import { Npm } from "../npm"
import { makeRuntime } from "../effect/runtime"
import { LayerNode } from "../effect/layer-node"

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

const runtime = makeRuntime(Npm.Service, LayerNode.compile(Npm.node))
const fingerprint = Bun.hash(JSON.stringify(versions)).toString(16)

export async function resolve(name: keyof Modules, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (typeof REDCODE_DESIGN_RUNTIME === "undefined") return createRequire(import.meta.url).resolve(name)
  const directory = path.join(Global.Path.cache, "design-runtime", fingerprint)
  await mkdir(directory, { recursive: true })
  await runtime.runPromise(
    (npm) =>
      npm.install(directory, { add: Object.entries(versions).map(([name, version]) => ({ name, version })) }).pipe(
        Effect.timeout("5 minutes"),
        Effect.mapError(
          (error) =>
            new Design.Error({
              code: "unavailable",
              message: `Unable to prepare Design tools in ${directory}: ${String(error)}. Check registry access and retry.`,
            }),
        ),
      ),
    { signal },
  )
  signal?.throwIfAborted()
  return createRequire(path.join(directory, "package.json")).resolve(name)
}

export async function load<K extends keyof Modules>(name: K, signal?: AbortSignal): Promise<Modules[K]> {
  // A variable file URL keeps Bun from bundling path-sensitive dependencies.
  return import(pathToFileURL(await resolve(name, signal)).href)
}
