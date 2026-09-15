import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { runtimeModules as keymapRuntimeModules } from "@opentui/keymap/runtime-modules"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/plugin/tui/runtime")
const RuntimeModules = await import("../../../src/plugin/tui/runtime-modules")

// OpenTUI's runtime plugin rewrites bare `from "…"` specifiers it finds in a module's text, string
// literals included, resolving them from TUI plugin files that imported runtime modules. On a
// hoisted install those plugin files resolve the host's packages, so host source loaded afterwards
// (the design store's React scaffold, `from "react-dom/client"`) had its literals turned into
// file URLs outside the application. Here a plugin directory with its own node_modules stands for
// the hoisted install.

const LITERAL = 'import { dep } from "scope-dep"'
const probes = globalThis as { __scopeProbe?: Record<string, unknown> }

/** A directory whose node_modules resolves `scope-dep`, standing for the hoisted install. */
async function writeDependency(directory: string) {
  await Bun.write(
    path.join(directory, "node_modules", "scope-dep", "package.json"),
    '{"name":"scope-dep","main":"index.js"}',
  )
  await Bun.write(path.join(directory, "node_modules", "scope-dep", "index.js"), "export const dep = 1\n")
}

/** Load one TUI plugin through the runtime, run `check`, then dispose. */
async function withPlugin(root: string, spec: string, check: () => Promise<void>) {
  const meta = process.env.REDCODE_PLUGIN_META_FILE
  process.env.REDCODE_PLUGIN_META_FILE = path.join(root, "plugin-meta.json")
  const config = createTuiResolvedConfig({
    plugin: [spec],
    plugin_origins: [{ spec, scope: "local", source: path.join(root, "tui.json") }],
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => root)
  probes.__scopeProbe = undefined
  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await check()
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    probes.__scopeProbe = undefined
    if (meta === undefined) delete process.env.REDCODE_PLUGIN_META_FILE
    else process.env.REDCODE_PLUGIN_META_FILE = meta
  }
}

test("the runtime-module rewrite applies to tui plugin modules, never to host source", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "plugin")
      await writeDependency(plugin)
      await Bun.write(
        path.join(plugin, "plugin.ts"),
        `import { createSignal } from "solid-js"
const probe = '${LITERAL}'
export default {
  id: "demo.scope",
  tui: async () => {
    createSignal(0)
    globalThis.__scopeProbe = { probe }
  },
}
`,
      )
      const host = path.join(dir, "host", "scaffold.ts")
      await Bun.write(host, `export const scaffold = '${LITERAL}'\n`)
      return { spec: pathToFileURL(path.join(plugin, "plugin.ts")).href, host }
    },
  })

  await withPlugin(tmp.path, tmp.extra.spec, async () => {
    // The plugin still loads through the runtime-module support and keeps its rewrite.
    expect(String(probes.__scopeProbe?.probe)).toContain("file://")
    // Host source loaded after the plugin keeps its text.
    const { scaffold } = await import(tmp.extra.host)
    expect(scaffold).toBe(LITERAL)
  })
})

test("a plugin import with a query suffix is admitted", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "query.ts"), "export const query = 1\n")
      await Bun.write(
        path.join(dir, "plugin.ts"),
        `import { query } from "./query.ts?v=1"
export default { id: "demo.query", tui: async () => { globalThis.__scopeProbe = { query } } }
`,
      )
      return { spec: pathToFileURL(path.join(dir, "plugin.ts")).href, query: path.join(dir, "query.ts") }
    },
  })

  expect(RuntimeModules.filePath("./query.ts?v=1", path.join(tmp.path, "plugin.ts"))).toBe(tmp.extra.query)
  await withPlugin(tmp.path, tmp.extra.spec, async () => {
    expect(probes.__scopeProbe?.query).toBe(1)
    expect(RuntimeModules.isAdmitted(tmp.extra.query)).toBe(true)
  })
})

test("a host module a plugin imports is neither admitted nor rewritten", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "plugin")
      await writeDependency(plugin)
      const host = path.join(dir, "host", "src", "scaffold.ts")
      await Bun.write(host, `export const scaffold = '${LITERAL}'\n`)
      await Bun.write(
        path.join(plugin, "plugin.ts"),
        `import { createSignal } from "solid-js"
import { scaffold } from ${JSON.stringify(host)}
export default { id: "demo.host", tui: async () => { createSignal(0); globalThis.__scopeProbe = { scaffold } } }
`,
      )
      return { spec: pathToFileURL(path.join(plugin, "plugin.ts")).href, host, root: path.join(dir, "host", "src") }
    },
  })

  RuntimeModules.protect(tmp.extra.root)
  await withPlugin(tmp.path, tmp.extra.spec, async () => {
    expect(probes.__scopeProbe?.scaffold).toBe(LITERAL)
    expect(RuntimeModules.isAdmitted(tmp.extra.host)).toBe(false)
  })
})

test("host source trees and design stores are protected by default", () => {
  const packages = path.resolve(import.meta.dir, "../../../..")
  expect(RuntimeModules.isProtected(path.join(packages, "core", "src", "design", "store.ts"))).toBe(true)
  expect(RuntimeModules.isProtected(path.join(packages, "redcode", "src", "plugin", "tui", "runtime.ts"))).toBe(true)
  expect(
    RuntimeModules.isProtected(path.join("/project", ".red", "code", "design", "design_1", "source", "main.tsx")),
  ).toBe(true)
  expect(RuntimeModules.isProtected(path.join(packages, "redcode", "test", "fixture", "plugin.ts"))).toBe(false)
})

test("a tsx plugin graph shares the Solid instance and renders JSX", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "label.ts"), 'export const label = "scoped-label"\n')
      await Bun.write(
        path.join(dir, "view.tsx"),
        `import { createSignal } from "solid-js"
import { label } from "./label"
export { createSignal }
export function View() {
  const [text] = createSignal(label)
  return <text>{text()}</text>
}
`,
      )
      await Bun.write(
        path.join(dir, "plugin.tsx"),
        `import { View, createSignal } from "./view"
export default { id: "demo.tsx", tui: async () => { globalThis.__scopeProbe = { View, createSignal } } }
`,
      )
      return { spec: pathToFileURL(path.join(dir, "plugin.tsx")).href }
    },
  })

  await withPlugin(tmp.path, tmp.extra.spec, async () => {
    // createSignal comes from view.tsx, two relative imports deep.
    expect(probes.__scopeProbe?.createSignal).toBe(createSignal)
    const View = probes.__scopeProbe?.View as () => any
    const app = await testRender(
      () => (
        <box width={20} height={2}>
          <View />
        </box>
      ),
      { width: 20, height: 2 },
    )
    try {
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("scoped-label")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("a plugin installed under node_modules loads with the shared runtime modules", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pkg = path.join(dir, "node_modules", "scope-nm-plugin")
      await Bun.write(
        path.join(pkg, "package.json"),
        JSON.stringify({ name: "scope-nm-plugin", version: "1.0.0", type: "module", exports: { "./tui": "./tui.js" } }),
      )
      await Bun.write(
        path.join(pkg, "tui.js"),
        `import { createSignal } from "solid-js"
export default { id: "demo.nm", tui: async () => { globalThis.__scopeProbe = { createSignal } } }
`,
      )
      return { spec: pathToFileURL(pkg).href }
    },
  })

  await withPlugin(tmp.path, tmp.extra.spec, async () => {
    expect(probes.__scopeProbe?.createSignal).toBe(createSignal)
  })
})

test("a module a plugin imports dynamically after loading stays in scope", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeDependency(dir)
      await Bun.write(
        path.join(dir, "late.ts"),
        `import { createSignal } from "solid-js"
export { createSignal }
export const text = '${LITERAL}'
`,
      )
      await Bun.write(
        path.join(dir, "plugin.ts"),
        `import { createSignal } from "solid-js"
export default {
  id: "demo.late",
  tui: async () => {
    createSignal(0)
    const late = await import("./late.ts")
    globalThis.__scopeProbe = { createSignal: late.createSignal, text: late.text }
  },
}
`,
      )
      return { spec: pathToFileURL(path.join(dir, "plugin.ts")).href, late: path.join(dir, "late.ts") }
    },
  })

  await withPlugin(tmp.path, tmp.extra.spec, async () => {
    expect(probes.__scopeProbe?.createSignal).toBe(createSignal)
    expect(String(probes.__scopeProbe?.text)).toContain("file://")
    expect(RuntimeModules.isAdmitted(tmp.extra.late)).toBe(true)
  })
})

test("a plugin loaded through a symlinked directory is admitted by its real path", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const real = path.join(dir, "real")
      await writeDependency(real)
      await Bun.write(path.join(real, "helper.ts"), `export const text = '${LITERAL}'\n`)
      await Bun.write(
        path.join(real, "plugin.ts"),
        `import { createSignal } from "solid-js"
import { text } from "./helper"
export default { id: "demo.link", tui: async () => { globalThis.__scopeProbe = { createSignal, text } } }
`,
      )
      const link = path.join(dir, "link")
      await fs.symlink(real, link, process.platform === "win32" ? "junction" : "dir")
      return { spec: pathToFileURL(path.join(link, "plugin.ts")).href, entry: path.join(real, "plugin.ts") }
    },
  })

  await withPlugin(tmp.path, tmp.extra.spec, async () => {
    expect(probes.__scopeProbe?.createSignal).toBe(createSignal)
    // Bun reports the module by its real path; admission through the link must match it.
    expect(RuntimeModules.isAdmitted(tmp.extra.entry)).toBe(true)
    // The relative helper loaded through the link as well.
    expect(String(probes.__scopeProbe?.text)).toContain("scope-dep")
  })
})

test("the install marker keeps OpenTUI from registering its unscoped plugin", () => {
  // If an OpenTUI upgrade renames or reshapes the marker, this returns true (or throws) and the
  // process-wide rewrite is back: fail here instead.
  expect(ensureRuntimePluginSupport({ additional: keymapRuntimeModules })).toBe(false)
  expect(RuntimeModules.markerProblem((globalThis as Record<symbol, unknown>)[RuntimeModules.INSTALLED_KEY])).toBe(
    undefined,
  )
  expect(RuntimeModules.markerProblem({})).toBeString()
  const again = RuntimeModules.ensureRuntimeModules(keymapRuntimeModules)
  expect(again.installed).toBe(false)
  expect(again.reason).toContain("already installed")
})

test("the installed OpenTUI matches the contract version", () => {
  expect(RuntimeModules.contractWarnings(RuntimeModules.installedVersions())).toEqual([])
  expect(RuntimeModules.installedVersions()["@opentui/core"]).toBe(RuntimeModules.OPENTUI_CONTRACT_VERSION)
  expect(RuntimeModules.contractWarnings({ "@opentui/core": "9.9.9", "@opentui/solid": undefined })).toHaveLength(1)
})
