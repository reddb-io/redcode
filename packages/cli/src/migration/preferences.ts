import path from "node:path"
import { Option, Schema } from "effect"
import { Info } from "../config/schema"
import { DisplayImport } from "./display"
import { TuiConfigV1 } from "@opencode/tui/config/v1"
import { TuiKeybind } from "@opencode/tui/config/v1/keybind"
import { Definitions } from "@opencode/tui/config/keybind"

const record = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const decode = Schema.decodeUnknownSync(Info, { onExcessProperty: "error" })
const current = Schema.decodeUnknownOption(Info, { onExcessProperty: "error" })
const legacy = Schema.decodeUnknownOption(TuiConfigV1.Info, { onExcessProperty: "error" })
const bindings = new Map(Object.entries(TuiKeybind.CommandMap))
const stored = Schema.Struct({
  theme: Schema.String.pipe(Schema.optional),
  theme_mode_lock: Schema.String.pipe(Schema.optional),
  attention_sound_pack: Schema.String.pipe(Schema.optional),
  diff_viewer_view: Schema.String.pipe(Schema.optional),
  diff_wrap_mode: Schema.String.pipe(Schema.optional),
  diff_viewer_show_file_tree: Schema.Boolean.pipe(Schema.optional),
  diff_viewer_single_patch: Schema.Boolean.pipe(Schema.optional),
  terminal_title_enabled: Schema.Boolean.pipe(Schema.optional),
  file_context_enabled: Schema.Boolean.pipe(Schema.optional),
  paste_summary_enabled: Schema.Boolean.pipe(Schema.optional),
  sidebar: Schema.String.pipe(Schema.optional),
  sidebar_width: Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.optional),
  scrollbar_visible: Schema.Boolean.pipe(Schema.optional),
  timestamps: Schema.Literals(["show", "hide"]).pipe(Schema.optional),
  generic_tool_output_visibility: Schema.Boolean.pipe(Schema.optional),
  tool_details_visibility: Schema.Boolean.pipe(Schema.optional),
  assistant_metadata_visibility: Schema.Boolean.pipe(Schema.optional),
  session_directory_filter_enabled: Schema.Boolean.pipe(Schema.optional),
  thinking_mode: Schema.Literals(["show", "hide"]).pipe(Schema.optional),
  thinking_visibility: Schema.Boolean.pipe(Schema.optional),
  exploration_grouping: Schema.Boolean.pipe(Schema.optional),
  animations_enabled: Schema.Boolean.pipe(Schema.optional),
})

export async function convertPreferences(input: unknown, source: string) {
  if (path.basename(source) === "kv.json")
    return {
      current: false,
      encoded: Schema.encodeSync(Info)(
        decode(
          DisplayImport.migrateV1(undefined, Schema.decodeUnknownSync(stored, { onExcessProperty: "error" })(input)),
        ),
      ),
    }
  const native = current(input)
  if (Option.isSome(native)) return { current: true, encoded: Schema.encodeSync(Info)(native.value) }
  const old = legacy(input)
  if (Option.isSome(old) && (path.basename(source) === "tui.json" || typeof old.value.theme === "string")) {
    if (old.value.keybinds) remapBindings(old.value.keybinds)
    return { current: false, encoded: Schema.encodeSync(Info)(decode(DisplayImport.migrateV1(old.value, {}))) }
  }
  const parsed = record(input)
  if (Option.isNone(parsed)) throw new Error("Display configuration is not an object")
  const value = { ...parsed.value }
  const tabs = record(value.tabs)
  if (Option.isSome(tabs) && "enabled" in tabs.value) {
    const fields = { ...tabs.value }
    if (typeof fields.enabled !== "boolean") throw new Error("Invalid historical tab toggle")
    fields.mode ??= fields.enabled ? "on" : "off"
    delete fields.enabled
    value.tabs = fields
  }
  const attention = record(value.attention)
  if (Option.isSome(attention) && "enabled" in attention.value) {
    const fields = { ...attention.value }
    if (typeof fields.enabled !== "boolean") throw new Error("Invalid historical attention toggle")
    fields.notifications ??= fields.enabled
    fields.sound ??= fields.enabled
    delete fields.enabled
    value.attention = fields
  }
  const terminal = record(value.terminal)
  if (Option.isSome(terminal) && "copy_on_select" in terminal.value) {
    const fields = { ...terminal.value }
    if (typeof fields.copy_on_select !== "boolean") throw new Error("Invalid historical copy setting")
    fields.copy ??= fields.copy_on_select ? "select" : "manual"
    delete fields.copy_on_select
    value.terminal = fields
  }
  const keys = record(value.keybinds)
  if (Option.isSome(keys)) value.keybinds = remapBindings(keys.value)
  return { current: false, encoded: Schema.encodeSync(Info)(decode(value)) }
}

function remapBindings(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => {
      const target = bindings.get(name) ?? name
      if (!(target in Definitions)) throw new Error("Display configuration contains an unsupported key binding")
      return [target, Object.hasOwn(input, target) ? input[target] : value]
    }),
  )
}
