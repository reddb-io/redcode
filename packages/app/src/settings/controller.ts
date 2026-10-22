import { settingsState } from "./state"
import {
  isExtensionTab,
  isProjectTab,
  isRootTab,
  isServerTab,
  type SettingsExtensionTab,
  type SettingsProjectTab,
  type SettingsRootTab,
  type SettingsServerTab,
  type SettingsView,
} from "./route"

export function createSettingsController(host: {
  view: () => SettingsView
  active: () => boolean
  show: (view: SettingsView) => void
  multiple: () => boolean
  extensions: () => ReadonlySet<string>
  goBack: () => void
}) {
  const search = settingsState({
    query: "",
    origin: undefined as SettingsView | undefined,
    selected: "",
    highlighted: "",
    scrollTop: 0,
    activation: 0,
    expanded: true,
  })

  return {
    search: {
      source: search,
      get state() {
        return search.getSnapshot()
      },
      input(query: string) {
        const state = search.getSnapshot()
        search.update({
          query,
          origin: !query.trim()
            ? undefined
            : !state.query.trim()
              ? { ...host.view(), target: undefined }
              : state.origin,
          selected: query.trim() ? state.selected : "",
          highlighted: "",
          scrollTop: 0,
          expanded: true,
        })
      },
      expand: () => search.update({ expanded: true }),
      highlight: (highlighted: string) => search.update({ highlighted }),
      scroll: (scrollTop: number) => search.update({ scrollTop }),
      open(destination: SettingsView, id: string) {
        const activation = search.getSnapshot().activation + 1
        host.show({ ...destination, searchActivation: activation })
        search.update({ selected: id, highlighted: id, expanded: false, activation })
      },
      clear: () =>
        search.update({ query: "", selected: "", highlighted: "", scrollTop: 0, origin: undefined, expanded: true }),
      back() {
        const state = search.getSnapshot()
        if (!state.query.trim() || !state.selected || !state.origin) return false
        host.show(state.origin)
        search.update({ selected: "", expanded: true })
        return true
      },
    },
    open: (tab: SettingsRootTab | SettingsExtensionTab = "general") => host.show({ type: "root", tab }),
    openServer: (server: string, tab: SettingsServerTab = "general") => host.show({ type: "server", server, tab }),
    replaceServer: (server: string, tab: SettingsServerTab = "general") => host.show({ type: "server", server, tab }),
    openProject(input: { server: string; project: string; tab?: SettingsProjectTab }) {
      host.show({ type: "project", ...input, parent: host.multiple() ? "server" : "root", tab: input.tab ?? "general" })
    },
    select(tab: string) {
      const current = host.view()
      const next: SettingsView =
        current.type === "root" && (isRootTab(tab) || isExtensionTab(tab, host.extensions()))
          ? { ...current, tab }
          : current.type === "server" && isServerTab(tab)
            ? { ...current, tab }
            : current.type === "project" && isProjectTab(tab)
              ? { ...current, tab }
              : current
      host.show({ ...next, target: undefined, subtab: undefined })
    },
    subtab: (subtab: SettingsView["subtab"]) => host.show({ ...host.view(), subtab, target: undefined }),
    back() {
      const current = host.view()
      if (current.type === "root") return host.goBack()
      host.show(
        current.type === "server" || current.parent === "root"
          ? { type: "root", tab: current.type === "server" ? "general" : "projects" }
          : { type: "server", server: current.server, tab: "projects" },
      )
    },
    close() {
      if (host.active()) host.goBack()
    },
  }
}
