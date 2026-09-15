import { plugin as registerBunPlugin, type BunPlugin, type OnResolveArgs } from "bun"
import { readdirSync, readFileSync, realpathSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import * as coreRuntime from "@opentui/core"
import {
  createRuntimePlugin,
  isCoreRuntimeModuleSpecifier,
  runtimeModuleIdForSpecifier,
  type RuntimeModuleEntry,
} from "@opentui/core/runtime-plugin"
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import * as solidRuntime from "@opentui/solid"
import * as solidComponentsRuntime from "@opentui/solid/components"
import * as solidJsxRuntime from "@opentui/solid/jsx-runtime"
import * as solidJsxDevRuntime from "@opentui/solid/jsx-dev-runtime"
import * as solidJsRuntime from "solid-js"
import * as solidJsStoreRuntime from "solid-js/store"

/**
 * OpenTUI's runtime-module support, scoped to TUI plugin modules.
 *
 * `ensureRuntimePluginSupport` registers a catch-all `onResolve` for the whole process: every source
 * file resolved afterwards gets a loader that rewrites bare `from "…"` specifiers found anywhere in its
 * text (string literals included) into file URLs resolved from plugin files. Host source loaded
 * lazily (the design store's React scaffold) was rewritten too, and on a hoisted install those URLs
 * point into the harness's node_modules. Here the same plugin only sees resolutions of admitted plugin
 * entries and of modules imported, directly or transitively, by admitted modules. Host source trees
 * and design stores are never admitted, even when a plugin imports them. Runtime module specifiers
 * keep resolving to the shared instances everywhere.
 */

/**
 * The OpenTUI release whose `configure` contract this module mirrors: the install marker below and
 * the options `createRuntimePlugin` is given. Re-check both when upgrading OpenTUI.
 */
export const OPENTUI_CONTRACT_VERSION = "0.4.5"

// @opentui/solid/runtime-plugin-support/configure reads this marker; setting it makes a later
// ensureRuntimePluginSupport call return false instead of registering the unscoped plugin.
export const INSTALLED_KEY = Symbol.for("opentui.solid.runtime-plugin-support")

const admitted = new Set<string>()
const canonical = new Map<string, string>()
const protectedRoots: string[] = []
const designStore = /[\\/]\.red[\\/]code[\\/]design(?:[\\/]|$)/

function key(file: string) {
  const cached = canonical.get(file)
  if (cached !== undefined) return cached
  const resolved = path.resolve(file)
  const value = (() => {
    try {
      return realpathSync.native(resolved)
    } catch {
      return resolved
    }
  })()
  canonical.set(file, value)
  return value
}

/** The file a specifier names from an importer, with any query or hash suffix removed. */
export function filePath(specifier: string, importer: string) {
  const clean = specifier.replace(/[?#].*$/, "")
  if (clean.startsWith("file:")) return fileURLToPath(clean)
  if (path.isAbsolute(clean)) return clean
  if (!importer) return
  try {
    const resolved = Bun.resolveSync(clean, path.dirname(importer))
    return path.isAbsolute(resolved) ? resolved : undefined
  } catch {
    return
  }
}

/** Never admit files under this directory, even when an admitted plugin imports them. */
export function protect(directory: string) {
  protectedRoots.push(key(directory))
}

export function isProtected(file: string) {
  const canonicalFile = key(file)
  return (
    designStore.test(canonicalFile) ||
    protectedRoots.some((root) => canonicalFile === root || canonicalFile.startsWith(root + path.sep))
  )
}

export function isAdmitted(file: string) {
  return admitted.has(key(file))
}

// In a source checkout this file lives at packages/redcode/src/plugin/tui; every workspace package's
// src is host source. A compiled binary bundles host source, so there is nothing on disk to protect.
const workspace = path.resolve(import.meta.dir, "../../../..")
if (path.basename(workspace) === "packages") {
  try {
    for (const name of readdirSync(workspace)) protect(path.join(workspace, name, "src"))
  } catch {}
}

/** Mark a TUI plugin entry (path or file URL) so the runtime-module rewrite applies to its module graph. */
export function admit(entry: string) {
  const file = filePath(entry, "")
  if (file && !isProtected(file)) admitted.add(key(file))
}

function scoped(plugin: BunPlugin, runtime: Set<string>): BunPlugin {
  const inScope = (args: OnResolveArgs) => {
    if (runtime.has(args.path)) return true
    if (args.importer && admitted.has(key(args.importer))) {
      const target = filePath(args.path, args.importer)
      if (!target || isProtected(target)) return false
      admitted.add(key(target))
      return true
    }
    const entry = filePath(args.path, "")
    return entry !== undefined && admitted.has(key(entry))
  }
  return {
    ...plugin,
    setup(build) {
      return plugin.setup(
        new Proxy(build, {
          get(target, property) {
            const value = Reflect.get(target, property, target)
            if (property !== "onResolve") return typeof value === "function" ? value.bind(target) : value
            const onResolve: typeof build.onResolve = (options, callback) =>
              target.onResolve(options, (args) => (inScope(args) ? callback(args) : undefined))
            return onResolve
          },
        }),
      )
    },
  }
}

/** Why an install marker does not have the shape OpenTUI's configure reads, if it does not. */
export function markerProblem(marker: unknown) {
  if (typeof marker !== "object" || marker === null) return "the marker is not an object"
  if (!("specifiers" in marker) || !(marker.specifiers instanceof Set)) return "the marker has no specifiers set"
  if (!("rewriteKey" in marker) || typeof marker.rewriteKey !== "string") return "the marker has no rewrite key"
  if (!("core" in marker) || !marker.core) return "the marker has no core runtime"
  return
}

/** The installed OpenTUI package versions, where they can be read from disk. */
export function installedVersions() {
  const read = (name: string) => {
    try {
      let directory = path.dirname(Bun.resolveSync(name, import.meta.dir))
      while (true) {
        const manifest = path.join(directory, "package.json")
        try {
          const json = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string }
          if (json.name === name) return json.version
        } catch {}
        const parent = path.dirname(directory)
        if (parent === directory) return
        directory = parent
      }
    } catch {
      return
    }
  }
  return { "@opentui/core": read("@opentui/core"), "@opentui/solid": read("@opentui/solid") }
}

/** Warnings for OpenTUI versions other than the one whose contract this module mirrors. */
export function contractWarnings(versions: Record<string, string | undefined>) {
  return Object.entries(versions).flatMap(([name, version]) =>
    version === undefined || version === OPENTUI_CONTRACT_VERSION
      ? []
      : [
          `${name} ${version} differs from ${OPENTUI_CONTRACT_VERSION}; re-check the runtime-plugin-support marker and options in plugin/tui/runtime-modules.ts`,
        ],
  )
}

export type Install = { installed: boolean; reason?: string; warnings: string[] }

export function ensureRuntimeModules(additional: Record<string, RuntimeModuleEntry>): Install {
  const warnings = contractWarnings(installedVersions())
  const state = globalThis as Record<symbol, unknown>
  const existing = state[INSTALLED_KEY]
  if (existing !== undefined) {
    const problem = markerProblem(existing)
    return {
      installed: false,
      reason: problem
        ? `OpenTUI's runtime-plugin-support marker has an unexpected shape (${problem}); runtime-module support may be unscoped`
        : "OpenTUI runtime-module support was already installed; it is not re-registered",
      warnings,
    }
  }
  const modules: Record<string, RuntimeModuleEntry> = {
    "@opentui/solid": solidRuntime,
    "@opentui/solid/components": solidComponentsRuntime,
    "@opentui/solid/jsx-runtime": solidJsxRuntime,
    "@opentui/solid/jsx-dev-runtime": solidJsxDevRuntime,
    "solid-js": solidJsRuntime,
    "solid-js/store": solidJsStoreRuntime,
    ...additional,
  }
  ensureSolidTransformPlugin({
    moduleName: runtimeModuleIdForSpecifier("@opentui/solid"),
    resolvePath(specifier) {
      if (!isCoreRuntimeModuleSpecifier(specifier) && !modules[specifier]) return null
      return runtimeModuleIdForSpecifier(specifier)
    },
  })
  const runtime = new Set(["@opentui/core", "@opentui/core/testing", ...Object.keys(modules)])
  registerBunPlugin(scoped(createRuntimePlugin({ core: coreRuntime, additional: modules }), runtime))
  state[INSTALLED_KEY] = { specifiers: new Set(Object.keys(modules)), core: coreRuntime, rewriteKey: "true:false" }
  return { installed: true, warnings }
}
