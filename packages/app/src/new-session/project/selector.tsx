import { type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { displayName } from "@opencode/ui/project-avatar-data"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { pathKey } from "@/workspaces/path-key"
import { handleDocumentSearchKeydown } from "@/shell/commands/search-keydown"
import { ProjectSelector, ProjectAddButton } from "./selector.react"

export type PromptProject = {
  name?: string
  id?: string
  worktree: string
  sandboxes?: string[]
  icon?: { color?: string; url?: string; override?: string }
  server?: { key: string; name: string }
}

export type PromptProjectControls = {
  available: PromptProject[]
  directory: string
  projectID?: string
  server?: string
  select: (worktree: string, server?: string) => void
  add: (title: string, server?: string) => void
}

const actionPrefix = "action:"

const projectPrefix = "project:"

function projectKey(project: PromptProject) {
  return `${projectPrefix}${encodeURIComponent(project.server?.key ?? "")}:${encodeURIComponent(project.worktree)}`
}

function actionKey(server?: string) {
  return `${actionPrefix}${encodeURIComponent(server ?? "")}`
}

export function createPromptProjectController(input: {
  controls: Accessor<PromptProjectControls>
  onDone: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ open: false, search: "", active: "" })
  let searchRef: HTMLInputElement | undefined

  const current = () => {
    const controls = input.controls()
    const key = pathKey(controls.directory)
    const projects = controls.available.filter((project) => !project.server || project.server.key === controls.server)

    return (
      projects.find(
        (project) =>
          pathKey(project.worktree) === key || project.sandboxes?.some((sandbox) => pathKey(sandbox) === key),
      ) ?? projects.find((project) => controls.projectID && project.id === controls.projectID)
    )
  }

  const selected = () => current() ?? input.controls().available[0]

  const projects = () => {
    const search = store.search.trim().toLowerCase()

    if (!search) return input.controls().available

    return input.controls().available.filter((project) => displayName(project).toLowerCase().includes(search))
  }

  const servers = () =>
    input
      .controls()
      .available.map((project) => project.server)
      .filter((server, index, all) => server && all.findIndex((item) => item?.key === server.key) === index)

  const keys = () => {
    if (servers().length <= 1) {
      return [...projects().map(projectKey), actionKey(servers()[0]?.key)]
    }

    return [
      ...servers().flatMap((server) =>
        projects()
          .filter((project) => project.server?.key === server!.key)
          .map(projectKey),
      ),
      actionKey(),
    ]
  }

  const initialActive = () => {
    const selectedKey = selected() ? projectKey(selected()!) : undefined
    const options = keys()

    if (selectedKey && options.includes(selectedKey)) return selectedKey

    return options[0] ?? ""
  }

  const close = () => {
    setStore({ open: false, search: "", active: "" })
    input.onDone()
  }

  const select = (project: PromptProject) => {
    if (
      pathKey(project.worktree) !== pathKey(current()?.worktree ?? "") ||
      project.server?.key !== current()?.server?.key
    ) {
      input.controls().select(project.worktree, project.server?.key)
    }

    close()
  }

  const add = (server?: string) => {
    setStore({ open: false, search: "", active: "" })
    input.controls().add(language.t("command.project.open"), server)
  }

  const setSearch = (value: string) => {
    const search = value.trim().toLowerCase()

    const first = input
      .controls()
      .available.find((project) => !search || displayName(project).toLowerCase().includes(search))

    setStore({
      search: value,
      active: first ? projectKey(first) : actionKey(servers().length > 1 ? undefined : servers()[0]?.key),
    })
  }

  return {
    selected,
    empty: () => input.controls().available.length === 0,
    projects,
    servers,
    projectKey,
    actionKey,
    open: () => store.open,
    search: () => store.search,
    active: () => store.active,
    labels: {
      add: () => language.t("session.new.project.add"),
      clear: () => language.t("common.clear"),
      new: () => language.t("session.new.project.new"),
      search: () => language.t("session.new.project.search"),
    },
    add,
    select,
    setOpen(open: boolean) {
      if (open) {
        setStore({ open: true, active: initialActive() })
        searchRef?.focus()

        return
      }

      setStore({ open: false, search: "", active: "" })
    },
    setSearch,
    clearSearch() {
      setStore({ search: "", active: initialActive() })
      searchRef?.focus()
    },
    setActive(key: string) {
      setStore("active", key)
    },
    moveActive(delta: number) {
      const options = keys()

      if (options.length === 0) return
      const index = options.indexOf(store.active)
      const start = index === -1 ? 0 : index
      setStore("active", options[(start + delta + options.length) % options.length])
    },
    activeProject() {
      return store.active.startsWith(projectPrefix)
        ? projects().find((project) => projectKey(project) === store.active)
        : undefined
    },
    activeServer() {
      return store.active.startsWith(actionPrefix)
        ? decodeURIComponent(store.active.slice(actionPrefix.length)) || undefined
        : undefined
    },
    activeAction() {
      return store.active.startsWith(actionPrefix)
    },
    setSearchRef(el: HTMLInputElement) {
      searchRef = el
    },
    focusSearch() {
      searchRef?.focus()
    },
    handleSearchKeydown(event: KeyboardEvent) {
      return handleDocumentSearchKeydown(searchRef, event, store.search, setSearch)
    },
  }
}

export type PromptProjectController = ReturnType<typeof createPromptProjectController>

export function createProjectSelectorServices(props: {
  controller: PromptProjectController
  placement?: "bottom" | "bottom-start"
}) {
  const language = useLanguage()
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      direction: language.direction(),
      open: props.controller.open(),
      search: props.controller.search(),
      active: props.controller.active(),
      selected: props.controller.selected(),
      selectedName: props.controller.selected() ? displayName(props.controller.selected()!) : undefined,
      projects: props.controller.projects().map((project) => ({
        project: { ...project, icon: project.icon ? { ...project.icon } : undefined },
        key: props.controller.projectKey(project),
        name: displayName(project),
      })),
      servers: props.controller.servers().filter((server) => server !== undefined),
      align: props.placement === "bottom-start" ? ("start" as const) : ("center" as const),
    })),
    controller: props.controller,
  }
}

export function PromptProjectSelector(props: Parameters<typeof createProjectSelectorServices>[0]) {
  const services = createProjectSelectorServices(props)
  return <ReactView component={ProjectSelector} props={{ services }} />
}

export function PromptProjectAddButton(props: { controller: PromptProjectController }) {
  const services = createProjectSelectorServices(props)
  return <ReactView component={ProjectAddButton} props={{ services }} />
}
