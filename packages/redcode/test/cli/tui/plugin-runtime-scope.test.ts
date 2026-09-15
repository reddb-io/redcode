import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/plugin/tui/runtime")

// OpenTUI's runtime plugin rewrites bare `from "…"` specifiers it finds in a module's text, string
// literals included, resolving them from TUI plugin files that imported runtime modules. On a
// hoisted install those plugin files resolve the host's packages, so host source loaded afterwards
// (the design store's React scaffold, `from "react-dom/client"`) had its literals turned into
// file URLs outside the application. Here the plugin directory stands for the hoisted install.
test("the runtime-module rewrite applies to tui plugin modules, never to host source", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "plugin")
      const file = path.join(plugin, "plugin.ts")
      const marker = path.join(dir, "probe.txt")
      await Bun.write(
        path.join(plugin, "node_modules", "scope-dep", "package.json"),
        '{"name":"scope-dep","main":"index.js"}',
      )
      await Bun.write(path.join(plugin, "node_modules", "scope-dep", "index.js"), "export const dep = 1\n")
      await Bun.write(
        file,
        `import { createSignal } from "solid-js"
const probe = 'import { dep } from "scope-dep"'
export default {
  id: "demo.scope",
  tui: async (_api, options) => {
    createSignal(0)
    await Bun.write(options.marker, probe)
  },
}
`,
      )
      const host = path.join(dir, "host", "scaffold.ts")
      await Bun.write(host, `export const scaffold = 'import { dep } from "scope-dep"'\n`)
      return { spec: pathToFileURL(file).href, marker, host, meta: path.join(dir, "plugin-meta.json") }
    },
  })

  const meta = process.env.REDCODE_PLUGIN_META_FILE
  process.env.REDCODE_PLUGIN_META_FILE = tmp.extra.meta
  const config = createTuiResolvedConfig({
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_origins: [
      {
        spec: [tmp.extra.spec, { marker: tmp.extra.marker }],
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    // The plugin still loads through the runtime-module support and keeps its rewrite.
    expect(await fs.readFile(tmp.extra.marker, "utf8")).toContain("file://")
    // Host source loaded after the plugin keeps its text.
    const { scaffold } = await import(tmp.extra.host)
    expect(scaffold).toBe('import { dep } from "scope-dep"')
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    if (meta === undefined) delete process.env.REDCODE_PLUGIN_META_FILE
    else process.env.REDCODE_PLUGIN_META_FILE = meta
  }
})
