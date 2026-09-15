import { plugin as registerBunPlugin, type BunPlugin, type OnResolveArgs } from "bun"
import { realpathSync } from "fs"
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
 * entries and of modules imported, directly or transitively, by admitted modules. Runtime module
 * specifiers keep resolving to the shared instances everywhere.
 */

// Mirrors @opentui/solid/runtime-plugin-support/configure so a later ensureRuntimePluginSupport call
// sees the support installed and does not register the unscoped plugin.
const installedKey = Symbol.for("opentui.solid.runtime-plugin-support")

const admitted = new Set<string>()
const canonical = new Map<string, string>()

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

function filePath(specifier: string, importer: string) {
  const clean = specifier.replace(/[?#].*$/, "")
  if (clean.startsWith("file:")) return fileURLToPath(clean)
  if (path.isAbsolute(clean)) return clean
  if (!importer) return
  try {
    const resolved = Bun.resolveSync(specifier, path.dirname(importer))
    return path.isAbsolute(resolved) ? resolved : undefined
  } catch {
    return
  }
}

/** Mark a TUI plugin entry (path or file URL) so the runtime-module rewrite applies to its module graph. */
export function admit(entry: string) {
  const file = filePath(entry, "")
  if (file) admitted.add(key(file))
}

function scoped(plugin: BunPlugin, runtime: Set<string>): BunPlugin {
  const inScope = (args: OnResolveArgs) => {
    if (runtime.has(args.path)) return true
    const target = args.importer && admitted.has(key(args.importer)) ? filePath(args.path, args.importer) : undefined
    const entry = target ? undefined : filePath(args.path, "")
    if (entry && admitted.has(key(entry))) return true
    if (!target) return false
    admitted.add(key(target))
    return true
  }
  return {
    ...plugin,
    setup(build) {
      return plugin.setup(
        new Proxy(build, {
          get(target, property, receiver) {
            if (property !== "onResolve") return Reflect.get(target, property, receiver)
            const onResolve: typeof build.onResolve = (options, callback) =>
              target.onResolve(options, (args) => (inScope(args) ? callback(args) : undefined))
            return onResolve
          },
        }),
      )
    },
  }
}

export function ensureRuntimeModules(additional: Record<string, RuntimeModuleEntry>) {
  const state = globalThis as Record<symbol, unknown>
  if (state[installedKey]) return false
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
  state[installedKey] = { specifiers: new Set(Object.keys(modules)), core: coreRuntime, rewriteKey: "true:false" }
  return true
}
