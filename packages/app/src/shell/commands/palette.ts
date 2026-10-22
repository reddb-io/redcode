import { createCommandPaletteFileEntry, type CommandPaletteEntry } from "./entries"
import { createServerSessionEntries } from "./session-entries"
export { createServerSessionEntries } from "./session-entries"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, onCleanup } from "solid-js"
import { commandPaletteOptions, useCommand, type CommandOption } from "@/shell/commands/command"
import { useFile } from "@/workspaces/files/model"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { useExtensionHost } from "@/runtime/extension/host"
import { useExtensionAttachment } from "@/runtime/extension/host-apis"

export type { CommandPaletteEntry } from "./entries"

const ENTRY_LIMIT = 5

// The palette opens with these host commands. Featured extension commands list before the view toggles.
const COMMON_COMMAND_IDS = ["session.new", "workspace.new", "session.previous", "session.next"] as const

const COMMON_VIEW_COMMAND_IDS = ["review.toggle"] as const

export { uniqueCommandPaletteEntries, createCommandPaletteFileEntry } from "./entries"
export function createCommandPaletteFileOpener(onOpenFile?: (path: string) => void) {
  const links = useExtensionHost().links
  const extensions = useExtensionAttachment()

  return (path: string) => {
    links.open({ href: path, exact: true, background: true, session: extensions.current() })
    onOpenFile?.(path)
  }
}

/** The highlighted option's preview cleanup, and whether the palette committed a choice. */
export type PaletteHighlight = { cleanup: (() => void) | void; committed: boolean }

export function createCommandPaletteModel(props: { filesOnly?: () => boolean; onOpenFile?: (path: string) => void }) {
  const command = useCommand()
  const global = useGlobal()
  const language = useLanguage()
  const file = useFile()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const serverCtx = global.ensureServerCtx(serverSDK.server)
  const appTabs = useTabs()
  const extensions = useExtensionAttachment()
  const openFile = createCommandPaletteFileOpener(props.onOpenFile)
  const state: PaletteHighlight = { cleanup: undefined, committed: false }
  const filesOnly = () => props.filesOnly?.() ?? false

  const allowedCommands = createMemo(() => {
    if (filesOnly()) return []

    return commandPaletteOptions(command.options)
  })

  const commandEntries = createMemo(() => {
    const category = language.t("palette.group.commands")

    return allowedCommands().map((option) => createCommandPaletteCommandEntry(option, category))
  })

  const preferredCommandEntries = createMemo(() => {
    const all = allowedCommands()

    const ids = [
      ...COMMON_COMMAND_IDS,
      ...all.flatMap((option) => (option.featured ? [option.id] : [])),
      ...COMMON_VIEW_COMMAND_IDS,
    ]

    const order = new Map<string, number>(ids.map((id, index) => [id, index]))
    const picked = all.filter((option) => order.has(option.id))
    const base = picked.length ? picked : all.slice(0, ENTRY_LIMIT)
    const sorted = picked.length ? [...base].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : base
    const category = language.t("palette.group.commands")

    return sorted.map((option) => createCommandPaletteCommandEntry(option, category))
  })

  const recentFileEntries = createMemo(() => {
    const all = extensions.files.opened()
    const active = extensions.files.active()
    const order = active ? [active, ...all.filter((path) => path !== active)] : all
    const category = language.t("palette.group.files")

    return order.slice(0, ENTRY_LIMIT).map((path) => createCommandPaletteFileEntry(path, category))
  })

  const rootFileEntries = createMemo(() => {
    const category = language.t("palette.group.files")

    return file.tree
      .children("")
      .filter((node) => node.type === "file")
      .map((node) => node.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, ENTRY_LIMIT)
      .map((path) => createCommandPaletteFileEntry(path, category))
  })

  const sessions = createServerSessionEntries({
    server: ServerConnection.key(serverSDK.server),
    opened: serverCtx.projects.list,
    stored: () => serverCtx.sync.data.project,
    load: (search, signal) => serverSDK.api.session.list({ parentID: null, search, limit: 50 }, { signal }),
    get: (sessionID, signal) => serverSDK.api.session.get({ sessionID }, { signal }),
    untitled: () => language.t("command.session.new"),
    category: () => language.t("command.category.session"),
    recentCategory: () => language.t("palette.group.recentSessions"),
  })

  const highlight = (item: CommandPaletteEntry | undefined) => {
    state.cleanup?.()
    state.cleanup = undefined

    if (item?.type !== "command") return
    state.cleanup = item.option?.onHighlight?.()
  }

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()

    if (item.type === "command") {
      void item.option?.onSelect?.("palette")

      return
    }

    if (item.type === "session") {
      if (!item.sessionID || !item.server) return
      const directory = item.project?.worktree ?? item.directory

      if (directory) {
        serverCtx.projects.open(directory)
        serverCtx.projects.touch(directory)
      }

      const tab = appTabs.addSessionTab({
        server: item.server,
        sessionId: item.sessionID,
      })

      appTabs.select(tab)

      return
    }

    if (!item.path) return
    openFile(item.path)
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return {
    language,
    file,
    commandEntries,
    preferredCommandEntries,
    recentFileEntries,
    rootFileEntries,
    sessions,
    highlight,
    select,
    close: () => dialog.close(),
  }
}

export function createCommandPaletteCommandEntry(option: CommandOption, category: string): CommandPaletteEntry {
  return {
    id: "command:" + option.id,
    type: "command",
    title: option.title,
    description: option.description,
    keybind: option.keybind,
    category,
    option,
  }
}
