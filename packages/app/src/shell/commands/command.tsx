import { createSimpleContext } from "@opencode/ui/context"
import { useDialog } from "@opencode/ui/context/dialog"
import { type Accessor, batch, createEffect, createMemo, onCleanup, onMount, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { keybindRenames } from "@/settings/keybinds/migration"
import {
  DEFAULT_PALETTE_KEYBIND,
  keyFromKeyboardEvent,
  parseKeybind,
  matchKeybind,
  formatKeybindParts,
  formatKeybind,
  type KeybindConfig,
} from "./keys"
export {
  DEFAULT_PALETTE_KEYBIND,
  keyFromKeyboardEvent,
  parseKeybind,
  matchKeybind,
  formatKeybindParts,
  formatKeybind,
  type KeybindConfig,
  type Keybind,
} from "./keys"
import { Persist, persisted } from "@/runtime/persistence/storage"

const PALETTE_ID = "command.palette"

const SUGGESTED_PREFIX = "suggested."

function actionId(id: string) {
  if (!id.startsWith(SUGGESTED_PREFIX)) return id

  return id.slice(SUGGESTED_PREFIX.length)
}

function signature(key: string, ctrl: boolean, meta: boolean, shift: boolean, alt: boolean) {
  const mask = (ctrl ? 1 : 0) | (meta ? 2 : 0) | (shift ? 4 : 0) | (alt ? 8 : 0)

  return `${key}:${mask}`
}

function signatureFromEvent(event: KeyboardEvent) {
  return signature(keyFromKeyboardEvent(event), event.ctrlKey, event.metaKey, event.shiftKey, event.altKey)
}

export const CommandSection = Schema.Literals(["general", "session", "navigation", "model", "terminal", "prompt"])

export type CommandSection = typeof CommandSection.Type

export interface CommandOption {
  id: string
  title: string
  description?: string
  category?: string
  /** Section of Settings > Shortcuts. Host commands leave it unset and are placed by id prefix. */
  section?: CommandSection
  keybind?: KeybindConfig
  slash?: string
  slashArguments?: boolean
  /** Listed right after the option whose slash name this is, when one is registered. */
  slashAfter?: string
  suggested?: boolean
  /** Listed when the command palette opens without a query. Host commands are listed by id instead. */
  featured?: boolean
  disabled?: boolean
  hidden?: boolean
  /** The keybind also fires while a text field has focus. */
  editable?: boolean
  when?: (event: KeyboardEvent) => boolean
  onSelect?: (source?: "palette" | "keybind" | "slash", input?: string) => void | Promise<void>
  onHighlight?: () => (() => void) | void
}

export function commandPaletteOptions(options: CommandOption[]) {
  return options.filter(
    (option) =>
      !option.disabled && !option.hidden && !option.id.startsWith(SUGGESTED_PREFIX) && option.id !== "file.open",
  )
}

export function resolveKeybindOption(candidates: CommandOption[] | undefined, event: KeyboardEvent) {
  return candidates?.find((option) => option.when?.(event)) ?? candidates?.find((option) => !option.when)
}

type CommandSource = "palette" | "keybind" | "slash"

export const CommandCatalogItem = Persistence.struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  section: Persistence.optional(CommandSection),
  keybind: Schema.optional(Schema.String),
  slash: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
})

export type CommandCatalogItem = typeof CommandCatalogItem.Type

export const CommandCatalog = Schema.Record(Schema.String, Schema.mutableKey(CommandCatalogItem))

export type CommandCatalog = typeof CommandCatalog.Type

export type CommandRegistration = {
  key?: string
  options: Accessor<CommandOption[]>
}

export function addCommandRegistration(registrations: CommandRegistration[], entry: CommandRegistration) {
  return [entry, ...registrations]
}

export function activeCommandRegistrations(registrations: CommandRegistration[]) {
  const keys = new Set<string>()

  return registrations.filter((entry) => {
    if (entry.key === undefined) return true

    if (keys.has(entry.key)) return false
    keys.add(entry.key)

    return true
  })
}

// Each option with `slashAfter` follows the first option with that slash name, so a command from another
// registration can sit inside that registration's slash list.
function placeAfterSlash(options: CommandOption[]) {
  const anchors = new Map<string, CommandOption>()
  options.forEach((option) => {
    if (option.slash && !option.slashAfter && !anchors.has(option.slash)) anchors.set(option.slash, option)
  })
  const moved = options.filter((option) => option.slashAfter && anchors.has(option.slashAfter))

  if (moved.length === 0) return options

  return options.flatMap((option) => {
    if (moved.includes(option)) return []

    if (!option.slash || anchors.get(option.slash) !== option) return [option]

    return [option, ...moved.filter((item) => item.slashAfter === option.slash)]
  })
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  if (target.isContentEditable) return true

  if (target.closest("[contenteditable='true']")) return true

  if (target.closest("input, textarea, select")) return true

  return false
}

export const { use: useCommand, provider: CommandProvider } = createSimpleContext({
  name: "Command",
  init: () => {
    const dialog = useDialog()
    const settings = useSettings()
    const language = useLanguage()

    const [store, setStore] = createStore({
      registrations: [] as CommandRegistration[],
      suspendCount: 0,
    })

    const warnedDuplicates = new Set<string>()

    const [catalog, setCatalog, _, catalogReady] = persisted(Persist.global("command.catalog.v1"), CommandCatalog, {})

    const bind = (id: string, def: KeybindConfig | undefined) => {
      const custom = settings.keybinds.get(actionId(id))
      const config = custom ?? def

      if (!config || config === "none") return

      return config
    }

    const registered = createMemo(() => {
      const seen = new Set<string>()
      const all: CommandOption[] = []

      for (const reg of activeCommandRegistrations(store.registrations)) {
        for (const opt of reg.options()) {
          if (seen.has(opt.id)) {
            if (import.meta.env.DEV && !warnedDuplicates.has(opt.id)) {
              warnedDuplicates.add(opt.id)
              console.warn(`[command] duplicate command id "${opt.id}" registered; keeping first entry`)
            }

            continue
          }

          seen.add(opt.id)
          all.push(opt)
        }
      }

      return placeAfterSlash(all)
    })

    createEffect(() => {
      if (!catalogReady()) return

      batch(() =>
        registered().forEach((opt) => {
          if (!opt.title) return
          setCatalog(
            actionId(opt.id),
            reconcile({
              title: opt.title,
              description: opt.description,
              category: opt.category,
              section: opt.section,
              keybind: opt.keybind,
              slash: opt.slash,
            }),
          )
        }),
      )
    })

    // Built-in GUI extensions republished these commands under new ids. Drop the old entries so
    // Settings > Shortcuts lists each command once.
    createEffect(() => {
      if (!catalogReady()) return
      const stale = untrack(() => Object.keys(keybindRenames).filter((id) => id in catalog))

      if (stale.length) setCatalog(produce((draft) => stale.forEach((id) => delete draft[id])))
    })

    const catalogOptions = createMemo(() => Object.entries(catalog).map(([id, meta]) => ({ id, ...meta })))

    const options = createMemo(() => {
      const resolved = registered().map((opt) => ({
        ...opt,
        keybind: bind(opt.id, opt.keybind),
      }))

      const suggested = resolved.filter((x) => x.suggested && !x.disabled)

      return [
        ...suggested.map((x) => ({
          ...x,
          id: SUGGESTED_PREFIX + x.id,
          category: language.t("command.category.suggested"),
        })),
        ...resolved,
      ]
    })

    const suspended = () => store.suspendCount > 0

    const palette = createMemo(() => {
      const config = settings.keybinds.get(PALETTE_ID) ?? DEFAULT_PALETTE_KEYBIND
      const keybinds = parseKeybind(config)

      return new Set(keybinds.map((kb) => signature(kb.key, kb.ctrl, kb.meta, kb.shift, kb.alt)))
    })

    const keymap = createMemo(() => {
      const map = new Map<string, CommandOption[]>()

      for (const option of options()) {
        if (option.id.startsWith(SUGGESTED_PREFIX)) continue

        if (option.disabled) continue

        if (!option.keybind) continue

        const keybinds = parseKeybind(option.keybind)

        for (const kb of keybinds) {
          if (!kb.key) continue
          const sig = signature(kb.key, kb.ctrl, kb.meta, kb.shift, kb.alt)
          const existing = map.get(sig)

          if (existing) {
            existing.push(option)
            continue
          }

          map.set(sig, [option])
        }
      }

      return map
    })

    const optionMap = createMemo(() => {
      const map = new Map<string, CommandOption>()

      for (const option of options()) {
        map.set(option.id, option)
        map.set(actionId(option.id), option)
      }

      return map
    })

    const run = (id: string, source?: CommandSource, input?: string) => {
      const option = optionMap().get(id)

      return option?.onSelect?.(source, input)
    }

    const showPalette = () => {
      run(PALETTE_ID, "palette")
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (suspended() || dialog.active) return

      const sig = signatureFromEvent(event)
      const isPalette = palette().has(sig)
      const option = resolveKeybindOption(keymap().get(sig), event)
      const modified = event.ctrlKey || event.metaKey || event.altKey
      const isTab = event.key === "Tab"

      if (isEditableTarget(event.target) && !isPalette && !option?.editable && !modified && !isTab) return

      if (isPalette) {
        event.preventDefault()
        event.stopPropagation()
        showPalette()

        return
      }

      if (!option) return
      event.preventDefault()
      event.stopPropagation()
      void option.onSelect?.("keybind")
    }

    onMount(() => {
      makeEventListener(document, "keydown", handleKeyDown, { capture: true })
    })

    function register(cb: () => CommandOption[]): void
    function register(key: string, cb: () => CommandOption[]): void
    function register(key: string | (() => CommandOption[]), cb?: () => CommandOption[]) {
      const id = typeof key === "string" ? key : undefined
      const next = typeof key === "function" ? key : cb

      if (!next) return
      const options = createMemo(next)

      const entry: CommandRegistration = {
        key: id,
        options,
      }

      // Register only committed owners. Updating the registry during a transition
      // can restore its pending snapshot after the outgoing owner's cleanup.
      onMount(() => setStore("registrations", (arr) => addCommandRegistration(arr, entry)))
      onCleanup(() => {
        setStore("registrations", (arr) => arr.filter((x) => x !== entry))
      })
    }

    const keybindConfig = (id: string) => {
      if (id === PALETTE_ID) return settings.keybinds.get(PALETTE_ID) ?? DEFAULT_PALETTE_KEYBIND
      const base = actionId(id)

      return options().find((x) => actionId(x.id) === base)?.keybind ?? bind(base, catalog[base]?.keybind)
    }

    return {
      register,
      trigger(id: string, source?: CommandSource, input?: string) {
        return run(id, source, input)
      },
      keybind(id: string) {
        const config = keybindConfig(id)

        if (!config) return ""

        return formatKeybind(config, language.t)
      },
      keybindParts(id: string) {
        const config = keybindConfig(id)

        return config ? formatKeybindParts(config, language.t) : []
      },
      /** The event matches the command's effective keybind (user override or default). */
      matches(id: string, event: KeyboardEvent) {
        const config = keybindConfig(id)

        return !!config && matchKeybind(parseKeybind(config), event)
      },
      show: showPalette,
      keybinds(enabled: boolean) {
        setStore("suspendCount", (count) => Math.max(0, count + (enabled ? -1 : 1)))
      },
      suspended,
      get catalog() {
        return catalogOptions()
      },
      get options() {
        return options()
      },
    }
  },
})
