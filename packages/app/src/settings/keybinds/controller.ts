import { settingsState } from "../state"
import fuzzysort from "fuzzysort"
import { DEFAULT_PALETTE_KEYBIND, formatKeybind, keyFromKeyboardEvent, parseKeybind } from "@/shell/commands/keys"
import type { useCommand, CommandSection } from "@/shell/commands/command"
import type { useLanguage } from "@/runtime/i18n/language"
import type { useSettings } from "../model"

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const PALETTE_ID = "command.palette"

export type KeybindGroup = "General" | "Session" | "Navigation" | "Model and agent" | "Terminal" | "Prompt"

type KeybindMeta = {
  title: string
  group: KeybindGroup
}

type KeybindMap = Record<string, string | undefined>

type CommandContext = ReturnType<typeof useCommand>

type LanguageContext = ReturnType<typeof useLanguage>

type SettingsContext = ReturnType<typeof useSettings>

const GROUPS: KeybindGroup[] = ["General", "Session", "Navigation", "Model and agent", "Terminal", "Prompt"]

type GroupKey =
  | "settings.shortcuts.group.general"
  | "settings.shortcuts.group.session"
  | "settings.shortcuts.group.navigation"
  | "settings.shortcuts.group.modelAndAgent"
  | "settings.shortcuts.group.terminal"
  | "settings.shortcuts.group.prompt"

export const groupKey: Record<KeybindGroup, GroupKey> = {
  General: "settings.shortcuts.group.general",
  Session: "settings.shortcuts.group.session",
  Navigation: "settings.shortcuts.group.navigation",
  "Model and agent": "settings.shortcuts.group.modelAndAgent",
  Terminal: "settings.shortcuts.group.terminal",
  Prompt: "settings.shortcuts.group.prompt",
}

const sectionGroup: Record<CommandSection, KeybindGroup> = {
  general: "General",
  session: "Session",
  navigation: "Navigation",
  model: "Model and agent",
  terminal: "Terminal",
  prompt: "Prompt",
}

function groupFor(id: string, section?: CommandSection): KeybindGroup {
  if (section) return sectionGroup[section]

  if (id === PALETTE_ID) return "General"

  if (id.startsWith("model.") || id.startsWith("agent.") || id.startsWith("mcp.")) return "Model and agent"

  if (id.startsWith("file.") || id.startsWith("fileTree.")) return "Navigation"

  if (id.startsWith("prompt.")) return "Prompt"

  if (
    id.startsWith("session.") ||
    id.startsWith("message.") ||
    id.startsWith("permissions.") ||
    id.startsWith("steps.") ||
    id.startsWith("review.")
  )
    return "Session"

  return "General"
}

function isModifier(key: string) {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta"
}

function recordKeybind(event: KeyboardEvent) {
  if (isModifier(event.key)) return

  const parts: string[] = []

  const mod = IS_MAC ? event.metaKey : event.ctrlKey

  if (mod) parts.push("mod")

  if (IS_MAC && event.ctrlKey) parts.push("ctrl")

  if (!IS_MAC && event.metaKey) parts.push("meta")

  if (event.altKey) parts.push("alt")

  if (event.shiftKey) parts.push("shift")

  const key = keyFromKeyboardEvent(event)

  if (!key) return
  parts.push(key)

  return parts.join("+")
}

function signatures(config: string | undefined) {
  if (!config) return []
  const sigs: string[] = []

  for (const kb of parseKeybind(config)) {
    const parts: string[] = []

    if (kb.ctrl) parts.push("ctrl")

    if (kb.alt) parts.push("alt")

    if (kb.shift) parts.push("shift")

    if (kb.meta) parts.push("meta")

    if (kb.key) parts.push(kb.key)

    if (parts.length === 0) continue
    sigs.push(parts.join("+"))
  }

  return sigs
}

function keybinds(value: unknown): KeybindMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  return value as KeybindMap
}

function listFor(command: Pick<CommandContext, "catalog" | "options">, map: KeybindMap, palette: string) {
  const out = new Map<string, KeybindMeta>()
  out.set(PALETTE_ID, { title: palette, group: "General" })

  for (const opt of command.catalog) {
    if (opt.id.startsWith("suggested.")) continue

    if (opt.hidden) continue
    out.set(opt.id, { title: opt.title, group: groupFor(opt.id, opt.section) })
  }

  for (const opt of command.options) {
    if (opt.id.startsWith("suggested.")) continue

    if (opt.hidden) continue
    out.set(opt.id, { title: opt.title, group: groupFor(opt.id, opt.section) })
  }

  for (const [id, value] of Object.entries(map)) {
    if (typeof value !== "string") continue

    if (out.has(id)) continue
    out.set(id, { title: id, group: groupFor(id) })
  }

  return out
}

function groupedFor(list: Map<string, KeybindMeta>) {
  const out = new Map<KeybindGroup, string[]>()

  for (const group of GROUPS) out.set(group, [])

  for (const [id, item] of list) {
    const ids = out.get(item.group)

    if (!ids) continue
    ids.push(id)
  }

  for (const group of GROUPS) {
    const ids = out.get(group)

    if (!ids) continue
    ids.sort((a, b) => (list.get(a)?.title ?? "").localeCompare(list.get(b)?.title ?? ""))
  }

  return out
}

function filteredFor(
  query: string,
  list: Map<string, KeybindMeta>,
  grouped: Map<KeybindGroup, string[]>,
  keybind: (id: string) => string,
) {
  const value = query.toLowerCase().trim()

  if (!value) return grouped

  const out = new Map<KeybindGroup, string[]>()

  for (const group of GROUPS) out.set(group, [])

  const items = Array.from(list.entries()).map(([id, meta]) => ({
    id,
    title: meta.title,
    group: meta.group,
    keybind: keybind(id),
  }))

  const results = fuzzysort.go(value, items, {
    keys: ["title", "keybind"],
    threshold: -10000,
  })

  for (const result of results) {
    const ids = out.get(result.obj.group)

    if (!ids) continue
    ids.push(result.obj.id)
  }

  return out
}

export function createKeybindSettingsController(
  input: {
    command: Pick<CommandContext, "catalog" | "options" | "keybinds">
    settings: {
      current: { keybinds: unknown }
      keybinds: Pick<SettingsContext["keybinds"], "get" | "set" | "resetAll">
    }
    target?: Document
    notify?: (toast: { title: string; description: string }) => void
  },
  language: Pick<LanguageContext, "locale" | "t">,
) {
  const state = settingsState({ active: null as string | null })
  const overrides = () => keybinds(input.settings.current.keybinds)

  const list = () => {
    language.locale()

    return listFor(input.command, overrides(), language.t("command.palette"))
  }

  const grouped = () => groupedFor(list())
  const title = (id: string) => list().get(id)?.title ?? ""

  const effective = (id: string) => {
    if (id === PALETTE_ID) return input.settings.keybinds.get(id) ?? DEFAULT_PALETTE_KEYBIND

    const custom = input.settings.keybinds.get(id)

    if (typeof custom === "string") return custom

    const live = input.command.options.find((item) => item.id === id)

    if (live?.keybind) return live.keybind

    return input.command.catalog.find((item) => item.id === id)?.keybind
  }

  const used = () => {
    const value = new Map<string, { id: string; title: string }[]>()

    for (const id of list().keys()) {
      for (const signature of signatures(effective(id))) {
        const items = value.get(signature)

        if (items) {
          items.push({ id, title: title(id) })
          continue
        }

        value.set(signature, [{ id, title: title(id) }])
      }
    }

    return value
  }

  const stop = () => {
    if (!state.getSnapshot().active) return
    state.update({ active: null })
    input.command.keybinds(true)
  }

  const toggle = (id: string) => {
    if (state.getSnapshot().active === id) {
      stop()

      return
    }

    if (state.getSnapshot().active) stop()
    state.update({ active: id })
    input.command.keybinds(false)
  }

  const notify = input.notify ?? (() => {})

  const handle = (event: KeyboardEvent) => {
    const id = state.getSnapshot().active

    if (!id) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    if (event.key === "Escape") {
      stop()

      return
    }

    const clear =
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey

    if (clear) {
      input.settings.keybinds.set(id, "none")
      stop()

      return
    }

    const next = recordKeybind(event)

    if (!next) return

    const conflicts = new Map<string, string>()

    for (const signature of signatures(next)) {
      for (const item of used().get(signature) ?? []) {
        if (item.id === id) continue
        conflicts.set(item.id, item.title)
      }
    }

    if (conflicts.size > 0) {
      notify({
        title: language.t("settings.shortcuts.conflict.title"),
        description: language.t("settings.shortcuts.conflict.description", {
          keybind: formatKeybind(next, language.t),
          titles: [...conflicts.values()].join(", "),
        }),
      })

      return
    }

    input.settings.keybinds.set(id, next)
    stop()
  }

  return {
    source: state,
    listen() {
      const target = input.target ?? document
      target.addEventListener("keydown", handle, { capture: true })
      return () => {
        target.removeEventListener("keydown", handle, { capture: true })
        stop()
      }
    },
    catalog: {
      groups: GROUPS,
      filtered: (query: string) =>
        filteredFor(query, list(), grouped(), (id) => formatKeybind(effective(id) ?? "", language.t)),
      title,
      keybind: (id: string) => formatKeybind(effective(id) ?? "", language.t),
    },
    capture: {
      active: () => state.getSnapshot().active,
      toggle,
    },
    settings: {
      hasOverrides: () => Object.values(overrides()).some((value) => typeof value === "string"),
      reset: () => {
        stop()
        input.settings.keybinds.resetAll()
        notify({
          title: language.t("settings.shortcuts.reset.toast.title"),
          description: language.t("settings.shortcuts.reset.toast.description"),
        })
      },
    },
  }
}
