import { NodeFileSystem } from "@effect/platform-node"
import { Flock } from "@opencode/util/flock"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem, Option, Schema } from "effect"
import { expect, test } from "bun:test"
import { applyEdits, modify, parse } from "jsonc-parser"
import path from "path"
import { DisplayImport } from "../../src/migration/display"
import { Config } from "../../src/config"
import { tmpdir } from "../fixture/tmpdir"

function run<A, E>(directory: string, effect: Effect.Effect<A, E, Config.Service>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const migrated = yield* DisplayImport.run({
        file: path.join(directory, "cli.json"),
        config: directory,
        state: directory,
      })
      if (migrated?.cause) return yield* Effect.failCause(migrated.cause)
      return yield* effect.pipe(Effect.provide(Config.layer))
    }).pipe(
      Effect.provide(Global.layerWith({ config: directory, state: directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

test("migrates tui and kv config into cli.json", async () => {
  await using directory = await tmpdir()
  await Bun.write(
    path.join(directory.path, "tui.json"),
    JSON.stringify({
      theme: "legacy",
      keybinds: {
        leader: "ctrl+o",
        app_exit: "ctrl+q",
        app_heap_snapshot: "ctrl+h",
        input_paste: { key: "ctrl+v", preventDefault: false },
        session_delete: false,
        "dialog.select.next": "ctrl+n",
      },
      leader_timeout: 500,
      scroll_speed: 2,
      scroll_acceleration: { enabled: true },
      diff_style: "stacked",
      mouse: false,
    }),
  )
  await Bun.write(
    path.join(directory.path, "kv.json"),
    JSON.stringify({
      theme_mode_lock: "light",
      attention_sound_pack: "custom.pack",
      diff_wrap_mode: "none",
      diff_viewer_show_file_tree: false,
      diff_viewer_single_patch: true,
      diff_viewer_view: "split",
      terminal_title_enabled: false,
      file_context_enabled: false,
      paste_summary_enabled: false,
      sidebar: "hide",
      scrollbar_visible: true,
      thinking_mode: "show",
      exploration_grouping: false,
      dismissed_getting_started: true,
      animations_enabled: false,
      skipped_version: "9.9.9",
      which_key_layout: "overlay",
    }),
  )

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )

  expect(config).toMatchObject({
    $schema: "https://opencode.ai/v2/cli.json",
    theme: { name: "legacy", mode: "light" },
    keybinds: {
      leader: "ctrl+o",
      "app.exit": "ctrl+q",
      "prompt.paste": { key: "ctrl+v", preventDefault: false },
      "session.delete": false,
      "dialog.select.next": "ctrl+n",
    },
    leader: { timeout: 500 },
    scroll: { speed: 2, acceleration: true },
    attention: { sound_pack: "custom.pack" },
    diffs: { wrap: "none", tree: false, single: true, view: "split" },
    terminal: { title: false },
    prompt: { editor: false, paste: "full" },
    session: { sidebar: "hide", scrollbar: true, thinking: "show", grouping: "none" },
    animations: false,
    mouse: false,
  })
  expect(config).not.toHaveProperty("skipped_version")
  expect(config).not.toHaveProperty("which_key")
  expect(config).not.toHaveProperty("hints")
  expect((await Bun.file(path.join(directory.path, "cli.json")).json()).keybinds).toEqual({
    leader: "ctrl+o",
    "app.exit": "ctrl+q",
    "prompt.paste": { key: "ctrl+v", preventDefault: false },
    "session.delete": false,
    "dialog.select.next": "ctrl+n",
  })
  expect(await Bun.file(path.join(directory.path, "cli.json")).exists()).toBe(true)
  expect(await Bun.file(path.join(directory.path, "tui.json")).exists()).toBe(true)
  expect(await Bun.file(path.join(directory.path, "kv.json")).exists()).toBe(true)
})

test("migrates before the first update and does not remigrate afterward", async () => {
  await using directory = await tmpdir()
  await Bun.write(path.join(directory.path, "tui.json"), JSON.stringify({ theme: "legacy" }))

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      yield* service.update((draft) => {
        draft.animations = false
        draft.mouse = false
      })
      yield* Effect.promise(() =>
        Bun.write(path.join(directory.path, "tui.json"), JSON.stringify({ theme: "changed" })),
      )
      return yield* service.get()
    }),
  )

  expect(config).toEqual({
    $schema: "https://opencode.ai/v2/cli.json",
    theme: { name: "legacy" },
    animations: false,
    mouse: false,
  })
  expect(await Bun.file(path.join(directory.path, "cli.json")).json()).toEqual({
    $schema: "https://opencode.ai/v2/cli.json",
    theme: { name: "legacy" },
    animations: false,
    mouse: false,
  })
})

test("imports newly supported V1 display preferences once into an existing cli.json", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(
    file,
    `{
  // Keep this preference and this comment
  "session": { "tool_details": "show", "timestamps": "hide" },
  "prompt": { "max_width": 90 }
}\n`,
  )
  await Bun.write(path.join(directory.path, "tui.json"), JSON.stringify({ prompt: { max_height: 20, max_width: 100 } }))
  await Bun.write(
    path.join(directory.path, "kv.json"),
    JSON.stringify({
      tool_details_visibility: false,
      assistant_metadata_visibility: true,
      timestamps: "show",
      generic_tool_output_visibility: false,
      session_directory_filter_enabled: true,
      sidebar_width: 44,
    }),
  )

  const first = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )
  expect(first.session).toMatchObject({
    tool_details: "show",
    assistant_metadata: "show",
    timestamps: "hide",
    generic_tool_output: "hide",
    list_scope: "directory",
    sidebar_width: 44,
  })
  expect(first.prompt).toMatchObject({ max_height: 20, max_width: 90 })
  expect(await Bun.file(file).text()).toContain("// Keep this preference and this comment")

  const text = await Bun.file(file).text()
  await Bun.write(file, applyEdits(text, modify(text, ["session", "assistant_metadata"], undefined, {})))
  await Bun.write(path.join(directory.path, "kv.json"), JSON.stringify({ assistant_metadata_visibility: false }))
  const second = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )
  expect(second.session?.assistant_metadata).toBeUndefined()
  expect(parse(await Bun.file(file).text()).session.tool_details).toBe("show")
})

test("preserves legacy cursor settings", async () => {
  await using directory = await tmpdir()
  await Bun.write(
    path.join(directory.path, "tui.json"),
    JSON.stringify({ cursor: { style: "underline", blinking: false } }),
  )

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )

  expect(config.cursor).toEqual({ style: "underline", blinking: false })
  expect((await Bun.file(path.join(directory.path, "cli.json")).json()).cursor).toEqual({
    style: "underline",
    blinking: false,
  })
})

test("migrates legacy keybind names in an existing cli.json", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(
    file,
    `{
  // Preserve this comment
  "keybinds": {
    // Session list shortcut
    "session_list": "ctrl+l",
    "app_heap_snapshot": "ctrl+h",
    // Legacy delete shortcut
    "session_delete": "ctrl+d",
    // Canonical delete shortcut
    "session.delete": "ctrl+x",
    "app.heap_snapshot": "ctrl+shift+h"
  }
}
`,
  )

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )

  expect(config.keybinds).toEqual({
    "session.list": "ctrl+l",
    "session.delete": "ctrl+x",
  })
  const text = await Bun.file(file).text()
  expect(text).toContain("// Preserve this comment")
  expect(text).toContain("// Session list shortcut")
  expect(text).toContain("// Legacy delete shortcut")
  expect(text).toContain("// Canonical delete shortcut")
  expect(parse(text).keybinds).toEqual({
    "session.list": "ctrl+l",
    "session.delete": "ctrl+x",
  })
})

test("migrates copy_on_select in an existing cli.json", async () => {
  for (const item of [
    { legacy: true, expected: "select" },
    { legacy: false, expected: "manual" },
    { legacy: true, copy: "manual", expected: "manual" },
  ] as const) {
    await using directory = await tmpdir()
    const file = path.join(directory.path, "cli.json")
    await Bun.write(
      file,
      `{
  // Preserve this comment
  "terminal": {
    ${item.copy === undefined ? "" : `"copy": ${JSON.stringify(item.copy)},`}
    "copy_on_select": ${item.legacy}
  }
}
`,
    )

    const config = await run(
      directory.path,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )

    expect(config.terminal).toEqual({ copy: item.expected })
    const text = await Bun.file(file).text()
    expect(text).toContain("// Preserve this comment")
    expect(text).not.toContain("copy_on_select")
    expect(parse(text).terminal).toEqual({ copy: item.expected })
  }
})

test("keeps explicit attention choices when removing the legacy master toggle", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(
    file,
    `{
  // Keep V2 preferences
  "attention": { "enabled": false, "notifications": true }
}\n`,
  )

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )

  expect(config.attention).toEqual({ notifications: true, sound: false })
  const text = await Bun.file(file).text()
  expect(text).toContain("// Keep V2 preferences")
  expect(parse(text).attention).toEqual({ notifications: true, sound: false })
})

test("preserves the effective value when migrating duplicate legacy keybinds", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, `{"keybinds":{"session_delete":"ctrl+a","session_delete":"ctrl+b"}}`)

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )

  expect(config.keybinds).toEqual({ "session.delete": "ctrl+b" })
  expect(parse(await Bun.file(file).text()).keybinds).toEqual({ "session.delete": "ctrl+b" })
})

test("migrates and updates the effective duplicate top-level keybinds", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, `{"keybinds":{"session_delete":"first"},"keybinds":{"session_delete":"last"}}`)

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      expect((yield* service.get()).keybinds).toEqual({ "session.delete": "last" })
      return yield* service.update((draft) => {
        draft.keybinds = { ...draft.keybinds, "session.delete": "changed" }
      })
    }),
  )

  expect(config.keybinds).toEqual({ "session.delete": "changed" })
  expect(parse(await Bun.file(file).text()).keybinds).toEqual({ "session.delete": "changed" })
})

test("removes orphaned keybinds without deleting trailing comments", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(
    file,
    `{
  "keybinds": {
    "app_heap_snapshot": "ctrl+h" /* Keep legacy explanation */,
    "app.heap_snapshot": "ctrl+shift+h" /* Keep canonical explanation */,
  },
}
`,
  )

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.get()
    }),
  )

  expect(config.keybinds).toEqual({})
  const text = await Bun.file(file).text()
  expect(text).toContain("/* Keep legacy explanation */")
  expect(text).toContain("/* Keep canonical explanation */")
  expect(parse(text).keybinds).toEqual({})
})
