import "@pierre/trees/web-components"
import { FileTree } from "@pierre/trees"
import { createEffect, createMemo, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { DirectoryPickerView } from "./dialog.react"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import type { LocationRef } from "@opencode/client/promise"
import {
  absoluteTreePath,
  activeTreeNavigation,
  advanceTreePreload,
  nextSuggestionIndex,
  nextTreeScrollTop,
  pickerFileSearchQuery,
  pickerAbsoluteInput,
  pickerMode,
  preloadTreeDirectories,
  cleanPickerInput,
  createPriorityTaskQueue,
  createDirectorySearch,
  currentPickerSuggestions,
  displayPickerPath,
  pickerParent,
  pickerRoot,
  listPickerDirectory,
  pickerRelativePath,
  pickerAbsolutePath,
} from "./domain"
import "./dialog.css"

interface DirectoryPickerDialogProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
  server: ServerConnection.Any
  location?: LocationRef
  mode?: "directory" | "file"
  start?: string
}

export function createDirectoryPickerServices(props: DirectoryPickerDialogProps) {
  const global = useGlobal()
  const context = global.ensureServerCtx(props.server)
  const sync = context.sync
  const sdk = context.sdk
  const modal = useNativeDialog()
  const language = useLanguage()
  const policy = pickerMode(props.mode ?? "directory", props.start)

  const action = {
    file: language.t("dialog.directory.action.selectFile"),
    directory: language.t("dialog.directory.action.selectFolder"),
  }

  const [state, setState] = createStore({
    root: "",
    input: "",
    selected: "",
    suggestionsOpen: false,
    activeSuggestion: -1,
    loading: false,
    error: false,
    rootValid: false,
    mounted: false,
  })
  const listings = new Map<string, Promise<Array<{ name: string; type: "file" | "directory" }> | undefined>>()
  const loads = createPriorityTaskQueue<Array<{ name: string; type: "file" | "directory" }> | undefined>(3)
  const advanced = new Set<string>()
  let tree: FileTree | undefined
  let navigation = 0

  const [fallbackPath] = createResource(
    () => (props.location ? undefined : true),
    () => sdk.api.location.get().catch(() => undefined),
    { initialValue: undefined },
  )

  const home = createMemo(() => sync.data.path.home || "")

  const location = createMemo(() => {
    const current = props.location ?? fallbackPath.latest

    return current ? { directory: current.directory } : undefined
  })

  const start = createMemo(
    () =>
      props.start ||
      sync.data.path.home ||
      props.location?.directory ||
      sync.data.path.directory ||
      fallbackPath.latest?.directory,
  )

  const search = createDirectorySearch({ sdk, home, location, base: () => state.root || start() })

  const [suggestions] = createResource(
    () => state.input,
    async (value) => {
      const cleaned = cleanPickerInput(value)
      const typed = cleaned.replace(/\/+$/, "")
      const current = displayPickerPath(state.root, value, home()).replace(/\/+$/, "")

      if (!cleaned || (state.root && typed === current)) return { query: value, items: [] }
      const directories = (await search(value)).map((absolute) => ({ absolute, type: "directory" as const }))

      if (!policy.includeFiles) return { query: value, items: directories.slice(0, 5) }
      const base = location()?.directory

      if (!base) return { query: value, items: directories.slice(0, 5) }
      const query = pickerRelativePath(base, pickerAbsoluteInput(cleaned, home(), state.root || base))

      if (query === undefined) return { query: value, items: directories.slice(0, 5) }

      const files = await sdk.api.file
        .find({
          location: location(),
          query,
          type: "file",
          limit: 20,
        })
        .then((result) => result.data)
        .catch(() => [])

      const results = [
        ...directories,
        ...files.map((entry) => ({ absolute: pickerAbsolutePath(entry.path, base), type: "file" as const })),
      ]

      return {
        query: value,
        items: Array.from(new Map(results.map((result) => [result.absolute, result])).values()).slice(0, 8),
      }
    },
  )

  const currentSuggestions = createMemo(() => currentPickerSuggestions(suggestions.latest, state.input))

  async function load(path: string, generation: number, eager = false) {
    const key = path.replace(/\/+$/, "")
    setState("error", false)
    const absolute = absoluteTreePath(state.root, key)
    const existing = listings.get(key)

    if (existing && !eager) loads.promote(`${generation}:${key}`)

    const request =
      existing ??
      loads.schedule(`${generation}:${key}`, eager ? "background" : "user", () => {
        if (!activeTreeNavigation(generation, navigation)) return Promise.resolve(undefined)
        const current = location()

        if (!current) return Promise.resolve(undefined)

        return listPickerDirectory(sdk, current, absolute).catch(() => undefined)
      })

    listings.set(key, request)
    const nodes = await request

    if (!activeTreeNavigation(generation, navigation)) return false

    if (!nodes) {
      listings.delete(key)

      if (!key) setState("error", true)

      return false
    }

    tree?.batch(policy.entries(key, nodes).map((item) => ({ type: "add", path: item })))

    if (!eager && advanceTreePreload(advanced, key)) {
      for (const directory of preloadTreeDirectories(key, nodes)) void load(directory, generation, true)
    }

    return true
  }

  async function navigate(path: string) {
    const value = policy.navigation(
      pickerAbsoluteInput(cleanPickerInput(path), home(), state.root || start() || home()),
    )

    if (!value) return
    const token = ++navigation
    setState("loading", true)
    setState("rootValid", false)
    setState("selected", "")
    setState("suggestionsOpen", false)
    setState("activeSuggestion", -1)
    setState("root", value)
    setState("input", displayPickerPath(value, value, home()))
    listings.clear()
    advanced.clear()
    tree?.resetPaths([])
    const valid = await load("", token)

    if (!activeTreeNavigation(token, navigation)) return
    setState("rootValid", valid)
    setState("loading", false)
  }

  function complete() {
    const items = currentSuggestions()
    const match = items[state.activeSuggestion] ?? items[0]

    if (!match) return
    const value = displayPickerPath(match.absolute, state.input, home())
    setState("input", match.type === "directory" && !value.endsWith("/") ? value + "/" : value)

    if (match.type === "file") {
      setState(
        "selected",
        policy.selection(state.root, pickerFileSearchQuery(state.root, match.absolute, home())) ?? "",
      )
      setState("suggestionsOpen", false)
      setState("activeSuggestion", -1)
    }
  }

  function chooseSuggestion(suggestion: { absolute: string; type: "file" | "directory" }) {
    if (suggestion.type === "directory") {
      void navigate(suggestion.absolute)

      return
    }

    setState("input", displayPickerPath(suggestion.absolute, state.input, home()))
    setState(
      "selected",
      policy.selection(state.root, pickerFileSearchQuery(state.root, suggestion.absolute, home())) ?? "",
    )
    setState("suggestionsOpen", false)
    setState("activeSuggestion", -1)
  }

  function moveSuggestion(delta: -1 | 1) {
    setState("suggestionsOpen", true)
    setState("activeSuggestion", (current) => nextSuggestionIndex(current, delta, currentSuggestions().length))
  }

  function activeSuggestionValue() {
    const items = currentSuggestions()

    return items[state.activeSuggestion] ?? items[0]
  }

  const keyActions = new Map([
    ["ArrowDown", () => moveSuggestion(1)],
    ["ArrowUp", () => moveSuggestion(-1)],
    [
      "Enter",
      () => {
        const suggestion = activeSuggestionValue()

        if (suggestion) chooseSuggestion(suggestion)

        if (!suggestion) void navigate(state.input)
      },
    ],
    ["Tab", complete],
  ])

  function handleInputKey(event: KeyboardEvent) {
    const action = keyActions.get(event.key)

    if (!action) return

    if (event.key === "Tab" && event.shiftKey) return
    event.preventDefault()
    action()
  }

  function resolve() {
    const path = policy.result(state.root, state.selected, state.rootValid)

    if (!path) return
    props.onSelect(props.multiple ? [path] : path)
    modal.close()
  }

  const mountTree = (container: HTMLDivElement) => {
    tree = new FileTree({
      paths: [],
      flattenEmptyDirectories: false,
      initialExpansion: "closed",
      stickyFolders: true,
      unsafeCSS: `
        button[data-type="item"] {
          background: transparent !important;
          box-shadow: none !important;
        }
        button[data-type="item"]:hover {
          background: var(--v2-overlay-simple-overlay-hover) !important;
        }
        button[data-type="item"]:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
        [data-file-tree-virtualized-scroll] {
          overscroll-behavior: contain;
          scrollbar-width: thin;
        }
      `,
      onExpansionChange(change) {
        if (change.expanded) void load(change.path, navigation)
      },
      onSelectionChange(paths) {
        const path = paths.at(-1)
        setState("selected", path ? (policy.selection(state.root, path) ?? "") : "")
      },
    })

    tree.render({ containerWrapper: container })
    tree.getFileTreeContainer()?.classList.add("directory-picker-tree")
    setState("mounted", true)
    return () => {
      tree?.cleanUp()
      tree = undefined
      setState("mounted", false)
    }
  }

  createEffect(() => {
    const path = start()

    if (!state.mounted || !path || !location() || state.root) return
    void navigate(path)
  })

  onCleanup(() => tree?.cleanUp())

  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      open: modal.open(),
      title: props.title ?? language.t("command.project.open"),
      action: action[policy.action],
      state: { ...state },
      result: policy.result(state.root, state.selected, state.rootValid),
      suggestions: currentSuggestions().map((suggestion) => ({
        ...suggestion,
        label:
          displayPickerPath(suggestion.absolute, state.input, home()) + (suggestion.type === "directory" ? "/" : ""),
      })),
    })),
    input: (value: string) =>
      setState({ input: cleanPickerInput(value), selected: "", suggestionsOpen: true, activeSuggestion: -1 }),
    active: (index: number) => setState("activeSuggestion", index),
    hideSuggestions: () => setState({ suggestionsOpen: false, activeSuggestion: -1 }),
    home: () => void navigate(home()),
    root: () => void navigate(pickerRoot(state.root) || state.root),
    parent: () => void navigate(pickerParent(state.root)),
    handleInputKey,
    chooseSuggestion,
    mountTree,
    scrollTree: (deltaY: number) => {
      const scroller = tree
        ?.getFileTreeContainer()
        ?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]")
      if (!scroller) return false
      const next = nextTreeScrollTop(scroller.scrollTop, deltaY, scroller.scrollHeight, scroller.clientHeight)
      if (next === scroller.scrollTop) return false
      scroller.scrollTop = next
      scroller.dispatchEvent(new Event("scroll"))
      return true
    },
    resolve,
    close: modal.close,
  }
}

export function DirectoryPickerDialog(props: DirectoryPickerDialogProps) {
  const services = createDirectoryPickerServices(props)
  return <ReactView component={DirectoryPickerView} props={{ services }} />
}
