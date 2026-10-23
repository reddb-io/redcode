/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Popover } from "@reddb-io/design-system/base/Popover"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { Icon } from "@/runtime/react/icon.react"
import { moveMenuFocus } from "@/runtime/react/menu-focus"
import { ProjectTile } from "@/shell/layout/project-tile.react"
import type { createProjectSelectorServices, PromptProject } from "./selector"

type Services = ReturnType<typeof createProjectSelectorServices>

export function ProjectAddButton(props: { services: Services }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  return (
    <Button
      data-action="prompt-project"
      variant="ghost"
      size="sm"
      className="max-w-[160px] gap-1.5 text-ink-muted"
      onClick={() => props.services.controller.add()}
    >
      <Icon name="folder-add-left" size="small" />
      <span className="min-w-0 truncate">{view.language.t("session.new.project.new")}</span>
      <Icon name="chevron-down" size="small" />
    </Button>
  )
}

export function ProjectSelector(props: { services: Services }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef<(() => void) | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  useLayoutEffect(() => {
    root.current?.querySelector("[data-popover-trigger]")?.setAttribute("data-action", "prompt-project")
  }, [])
  useEffect(() => {
    if (view.open || !pending.current) return
    const action = pending.current
    pending.current = undefined
    queueMicrotask(action)
  }, [view.open])
  const closeThen = (action: () => void) => {
    pending.current = action
    setAdding(false)
    services.controller.setOpen(false)
  }
  const selected = view.projects.find(
    (item) => item.key === (view.selected && services.controller.projectKey(view.selected)),
  )
  const label = selected?.name ?? view.selectedName ?? view.language.t("session.new.project.new")
  return (
    <div ref={root} className="contents">
      <Popover
        triggerLabel={label}
        contentLabel={view.language.t("session.new.project.search")}
        open={view.open}
        onOpenChange={(open) => {
          setAdding(false)
          services.controller.setOpen(open)
        }}
        align={view.align}
        sideOffset={4}
        variant="ghost"
        size="sm"
        triggerClass="max-w-[203px] justify-start gap-1.5 text-ink-muted"
        trigger={
          <>
            {view.selected ? <ProjectTile project={view.selected} /> : <Icon name="folder-add-left" size="small" />}
            <span className="min-w-0 truncate">{label}</span>
            <Icon name="chevron-down" size="small" />
          </>
        }
        className="w-[260px] max-w-[calc(100vw-24px)] overflow-hidden p-1"
      >
        {view.open && (
          <ProjectOptions
            services={services}
            adding={adding}
            setAdding={setAdding}
            select={(project) => closeThen(() => services.controller.select(project))}
            add={(server) => closeThen(() => services.controller.add(server))}
          />
        )}
      </Popover>
    </div>
  )
}

function ProjectOptions(props: {
  services: Services
  adding: boolean
  setAdding: (open: boolean) => void
  select: (project: PromptProject) => void
  add: (server?: string) => void
}) {
  const services = props.services
  const controller = services.controller
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const input = useRef<HTMLInputElement>(null)
  const options = useRef<HTMLDivElement>(null)
  const language = view.language
  const active = () => {
    const item = options.current?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(view.active)}"]`)
    return item instanceof HTMLButtonElement ? item : item?.querySelector<HTMLButtonElement>("button")
  }
  useEffect(() => {
    if (props.adding) return
    const handler = (event: KeyboardEvent) => {
      // Submenu arrows belong to its trigger; text-search shortcuts keep their existing owner.
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        event.target instanceof Element &&
        event.target.closest("[data-option-key]")?.getAttribute("data-option-key") === controller.actionKey()
      )
        return
      controller.handleSearchKeydown(event)
    }
    document.addEventListener("keydown", handler, true)
    return () => document.removeEventListener("keydown", handler, true)
  }, [controller, props.adding])
  useLayoutEffect(() => {
    input.current?.focus()
  }, [])
  useLayoutEffect(() => {
    active()?.scrollIntoView({ block: "nearest" })
  }, [view.active])
  const row = (item: (typeof view.projects)[number]) => (
    <ListRow
      key={item.key}
      id={item.key}
      data-option-key={item.key}
      role="menuitemradio"
      aria-checked={view.selected && controller.projectKey(view.selected) === item.key}
      selected={view.active === item.key}
      size="sm"
      className="w-full"
      leading={<ProjectTile project={item.project} />}
      trailing={
        view.selected && controller.projectKey(view.selected) === item.key && <Icon name="check" size="small" />
      }
      onMouseEnter={() => controller.setActive(item.key)}
      onClick={() => props.select(item.project)}
    >
      <span className="min-w-0 truncate">{item.name}</span>
    </ListRow>
  )
  return (
    <>
      <div className="flex items-center gap-1 px-1">
        <Icon name="magnifying-glass" size="small" className="shrink-0 text-ink-muted" />
        <Input
          ref={(element) => {
            input.current = element
            if (element) controller.setSearchRef(element)
          }}
          autoFocus
          type="search"
          controlSize="sm"
          value={view.search}
          onValueChange={controller.setSearch}
          placeholder={language.t("session.new.project.search")}
          aria-label={language.t("session.new.project.search")}
          aria-autocomplete="list"
          aria-controls="prompt-project-menu"
          aria-activedescendant={view.active || undefined}
          onKeyDown={(event) => {
            if (event.key === "Tab" && !event.shiftKey) {
              event.preventDefault()
              active()?.focus()
              return
            }
            if (event.altKey || event.metaKey) return
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              controller.moveActive(event.key === "ArrowDown" ? 1 : -1)
              return
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            const project = controller.activeProject()
            if (project) return props.select(project)
            if (view.servers.length > 1) return props.setAdding(true)
            props.add(controller.activeServer())
          }}
        />
        {view.search && (
          <Button variant="ghost" size="sm" aria-label={language.t("common.clear")} onClick={controller.clearSearch}>
            <Icon name="circle-xmark" size="small" />
          </Button>
        )}
      </div>
      <div
        ref={options}
        id="prompt-project-menu"
        role="menu"
        aria-label={language.t("session.new.project.search")}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          controller.moveActive(event.key === "ArrowDown" ? 1 : -1)
          queueMicrotask(() => {
            const key = controller.active()
            const item = options.current?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(key)}"]`)
            if (item instanceof HTMLButtonElement) return item.focus()
            item?.querySelector<HTMLButtonElement>("button")?.focus()
          })
        }}
      >
        <ScrollArea variant="plain" label={language.t("session.new.project.search")} className="max-h-56 py-1">
          {view.servers.length > 1
            ? view.servers.map((server) => {
                const projects = view.projects.filter((item) => item.project.server?.key === server.key)
                if (!projects.length) return null
                return (
                  <div key={server.key} role="group" aria-label={server.name}>
                    <div className="px-2 py-1 text-eyebrow uppercase text-ink-muted">{server.name}</div>
                    {projects.map(row)}
                  </div>
                )
              })
            : view.projects.map(row)}
        </ScrollArea>
        <hr className="my-1 border-muted" />
        {view.servers.length > 1 ? (
          <div
            id={controller.actionKey()}
            data-option-key={controller.actionKey()}
            className="contents"
            onKeyDown={(event) => {
              const forward = view.direction === "rtl" ? "ArrowLeft" : "ArrowRight"
              if (event.key !== forward && event.key !== (view.direction === "rtl" ? "ArrowRight" : "ArrowLeft")) return
              event.preventDefault()
              event.stopPropagation()
              props.setAdding(event.key === forward)
            }}
          >
            <Popover
              open={props.adding}
              onOpenChange={props.setAdding}
              triggerLabel={language.t("session.new.project.add")}
              contentLabel={language.t("session.new.project.add")}
              variant="ghost"
              size="sm"
              side={view.direction === "rtl" ? "left" : "right"}
              triggerClass="w-full justify-start"
              trigger={
                <>
                  <Icon name="plus" size="small" />
                  {language.t("session.new.project.add")}
                  <Icon name={view.direction === "rtl" ? "chevron-left" : "chevron-right"} size="small" />
                </>
              }
              className="min-w-44 max-w-[calc(100vw-24px)] p-1"
            >
              <div role="menu" aria-label={language.t("session.new.project.add")} onKeyDown={moveMenuFocus}>
                {view.servers.map((server) => (
                  <ListRow key={server.key} role="menuitem" className="w-full" onClick={() => props.add(server.key)}>
                    {server.name}
                  </ListRow>
                ))}
              </div>
            </Popover>
          </div>
        ) : (
          <ListRow
            id={controller.actionKey(view.servers[0]?.key)}
            data-option-key={controller.actionKey(view.servers[0]?.key)}
            role="menuitem"
            size="sm"
            selected={controller.activeAction()}
            className="w-full"
            leading={<Icon name="plus" size="small" />}
            onMouseEnter={() => controller.setActive(controller.actionKey(view.servers[0]?.key))}
            onClick={() => props.add(view.servers[0]?.key)}
          >
            {language.t("session.new.project.add")}
          </ListRow>
        )}
      </div>
    </>
  )
}
