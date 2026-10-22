import { createMemo, mapArray } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useTabs } from "@/shell/tabs/tabs"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { sharedState } from "@/runtime/react/state"
import { sharedSource, observeShared } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedMount } from "@/runtime/react/mount"
import { ReactView } from "@/runtime/react/view"
import { createCommandPaletteFileEntry, createCommandPaletteModel, type CommandPaletteEntry } from "./palette"
import { createCommandPaletteSearch } from "./search"
import { CommandPalette } from "./dialog.react"

export function matchesCommandPaletteEntry(entry: CommandPaletteEntry, query: string) {
  const value = query.toLowerCase()

  return [entry.title, entry.description, entry.category].some((text) => text?.toLowerCase().includes(value))
}

export function DialogCommandPalette(props: { onOpenFile?: (path: string) => void }) {
  const palette = createCommandPaletteModel(props)

  const items = (q: string) => {
    if (!q) return [...palette.preferredCommandEntries(), ...palette.recentFileEntries()]

    return palette.commandEntries().filter((entry) => matchesCommandPaletteEntry(entry, q))
  }

  return (
    <CommandPaletteView
      placeholder={palette.language.t("palette.search.placeholder")}
      items={items}
      sources={[
        palette.sessions,
        async (query, signal) => {
          if (!query) return []
          const files = await palette.file.searchFiles(query, { signal })
          const category = palette.language.t("palette.group.files")

          return files.map((path) => createCommandPaletteFileEntry(path, category))
        },
      ]}
      highlight={palette.highlight}
      select={palette.select}
      close={palette.close}
    />
  )
}

export function CommandPaletteView(props: {
  placeholder: string
  items: (query: string) => CommandPaletteEntry[]
  sources: ((query: string, signal: AbortSignal) => Promise<CommandPaletteEntry[]>)[]
  highlight: (item: CommandPaletteEntry | undefined) => void
  select: (item: CommandPaletteEntry | undefined) => void
  close: () => void
}) {
  const language = useLanguage()
  const tabs = useTabs()
  const state = sharedState({ query: "" })
  const query = observeShared(state)
  const search = createCommandPaletteSearch({ query: () => query().query, items: props.items, sources: props.sources })
  // These remaining generic avatar renderers retain their server subscriptions and clean up per result.
  const avatars = createMemo(
    mapArray(
      () =>
        search
          .items()
          .filter((entry) => entry.type === "session" && entry.server && entry.directory && entry.sessionID),
      (entry) => ({
        id: entry.id,
        mount: sharedMount(() => (
          <SessionTabAvatar
            project={entry.project}
            directory={entry.directory!}
            sessionId={entry.sessionID!}
            server={entry.server!}
          />
        )),
      }),
    ),
  )
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    placeholder: props.placeholder,
    query: query().query,
    items: search.items(),
    loading: search.loading(),
    avatars: Object.fromEntries(avatars().map((entry) => [entry.id, entry.mount])),
    openSessions: new Set(
      tabs.store.flatMap((tab) => (tab.type === "session" ? [`${tab.server}\0${tab.sessionId}`] : [])),
    ),
  }))
  return (
    <ReactView
      component={CommandPalette}
      props={{
        source,
        setQuery: (query: string) => state.update({ query }),
        highlight: props.highlight,
        select: props.select,
        close: props.close,
      }}
    />
  )
}
