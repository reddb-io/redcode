/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { getFilename } from "@opencode/util/path"
import { displayName } from "@opencode/ui/project-avatar-data"
import type { LocalProject } from "@/shell/state/layout"
import type { createSettingsProjectsServices } from "./projects"
import { SettingsSearchEmpty } from "../search-empty.react"
import { SettingsSearchField } from "../search-field.react"
import { SettingsIcon } from "../icon.react"
import { ProjectTile } from "./project-tile.react"
import { ProjectOptions } from "./project-options.react"

type Services = ReturnType<typeof createSettingsProjectsServices>
type Snapshot = ReturnType<Services["snapshot"]["getSnapshot"]>
export function Projects(props: { services: Services }) {
  const state = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const language = state.language
  const [filter, setFilter] = useState("")
  const searchable = state.projects.length > 7
  useEffect(() => {
    if (!searchable) setFilter("")
  }, [searchable])
  const query = searchable ? filter.trim().toLowerCase() : ""
  const filtered = query
    ? state.projects.filter((project) => displayName(project).toLowerCase().includes(query))
    : state.projects
  return (
    <>
      <div className={`settings-tab-header${searchable ? " settings-tab-header--stacked" : ""}`}>
        <div className="settings-tab-header-row">
          <div className="flex flex-col gap-1">
            <h2 className="settings-tab-title">{language.t("settings.projects.title")}</h2>
            <span className="text-11-regular text-ink-muted">{language.t("settings.projects.description")}</span>
          </div>
          {!!state.projects.length && (
            <Button variant="ghost" size="sm" onClick={props.services.addProject}>
              <SettingsIcon name="plus" />
              {language.t("home.project.add")}
            </Button>
          )}
        </div>
        {searchable && (
          <SettingsSearchField
            value={filter}
            active={state.active}
            onInput={setFilter}
            placeholder={language.t("settings.projects.search.placeholder")}
            language={language}
          />
        )}
      </div>
      <div className="settings-tab-body">
        {filtered.length ? (
          <div role="list" className="settings-project-list">
            {filtered.map((project) => (
              <ProjectRow key={project.worktree} project={project} snapshot={state} services={props.services} />
            ))}
          </div>
        ) : !filter.trim() && !state.projects.length ? (
          <div
            data-component="settings-project-empty-card"
            className="settings-project-empty-card flex flex-col items-center gap-2 py-24 text-center"
          >
            <SettingsIcon name="folder" className="mb-2 text-ink-muted" />
            <div className="text-13-medium text-foreground">{language.t("settings.projects.empty.title")}</div>
            <div className="text-13-regular text-ink-muted">{language.t("settings.projects.empty.description")}</div>
            <Button className="mt-6" size="sm" onClick={props.services.addProject}>
              <SettingsIcon name="plus" />
              {language.t("home.project.add")}
            </Button>
          </div>
        ) : filter.trim() ? (
          <div className="settings-tab-search-empty">
            <SettingsSearchEmpty query={filter} language={language} />
          </div>
        ) : (
          <div className="py-12 text-center text-ink-muted text-13-regular">
            {language.t("settings.projects.empty")}
          </div>
        )}
      </div>
    </>
  )
}
function ProjectRow(props: { project: LocalProject & { unseen: number }; snapshot: Snapshot; services: Services }) {
  const language = props.snapshot.language
  const [menu, setMenu] = useState(false)
  const [editor, setEditor] = useState<{ draft: string; saving: boolean }>()
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const openEditor = () => {
    setMenu(false)
    setEditor({ draft: displayName(props.project), saving: false })
  }
  useLayoutEffect(() => {
    if (!editor) return
    input.current?.focus()
    input.current?.select()
  }, [!!editor])
  const closeEditor = () => {
    if (!editor?.saving) setEditor(undefined)
  }
  const saveEditor = async () => {
    if (!editor || editor.saving) return
    const name = editor.draft.trim()
    if (!name || name === displayName(props.project)) {
      closeEditor()
      requestAnimationFrame(() => button.current?.focus())
      return
    }
    setEditor({ ...editor, saving: true })
    const saved = await props.services.actions
      .persist(props.project, { name: name === getFilename(props.project.worktree) ? "" : name })
      .then(
        () => true,
        (error) => {
          props.services.actions.notify(error)
          return false
        },
      )
    const restore = document.activeElement === document.body || document.activeElement === input.current
    if (saved) setEditor(undefined)
    if (!saved) setEditor((previous) => (previous ? { ...previous, saving: false } : previous))
    if (restore) requestAnimationFrame(() => (saved ? button.current : input.current)?.focus())
  }
  return (
    <div className="settings-project-row-shell">
      <div
        role="listitem"
        data-component="settings-project-card"
        data-menu={menu ? "true" : undefined}
        className="settings-project-card"
      >
        {editor ? (
          <div className="flex h-full min-w-0 flex-1 items-center gap-2">
            <ProjectTile project={props.project} className="shrink-0" />
            <Input
              ref={input}
              aria-label={language.t("common.rename")}
              dir="auto"
              value={editor.draft}
              disabled={editor.saving}
              className="w-full text-[13px] font-medium leading-5 text-foreground"
              onValueChange={(draft) => setEditor((previous) => (previous ? { ...previous, draft } : previous))}
              onBlur={closeEditor}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                if (event.key === "Enter") {
                  event.preventDefault()
                  void saveEditor()
                  return
                }
                if (event.key !== "Escape") return
                event.preventDefault()
                closeEditor()
                requestAnimationFrame(() => button.current?.focus())
              }}
            />
          </div>
        ) : (
          <button
            ref={button}
            type="button"
            aria-label={displayName(props.project)}
            title={props.project.worktree}
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-sm bg-transparent text-start focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
            onClick={() => props.services.openProject(props.project)}
          >
            <ProjectTile project={props.project} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              <bdi dir="auto">{displayName(props.project)}</bdi>
            </span>
          </button>
        )}
        <ProjectOptions
          project={props.project}
          language={language}
          actions={props.services.actions}
          presentation={props.snapshot.presentation}
          unseen={props.project.unseen}
          open={menu}
          onOpenChange={setMenu}
          onEdit={() => props.services.openProject(props.project)}
          onRename={openEditor}
        />
      </div>
    </div>
  )
}
