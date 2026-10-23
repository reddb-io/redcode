/** @jsxImportSource react */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Popover } from "@reddb-io/design-system/base/Popover"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { Icon } from "@/runtime/react/icon.react"
import { moveMenuFocus } from "@/runtime/react/menu-focus"
import type { createGitStatusSource, createWorkspaceSelectorServices } from "./selector"

type Services = ReturnType<typeof createWorkspaceSelectorServices>

export function WorkspaceSelector(props: { services: Services }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const [open, setOpen] = useState({ workspace: false, existing: false, branch: false })
  const [search, setSearch] = useState({ worktrees: "", branches: "" })
  const pending = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (open.workspace || open.branch || !pending.current) return
    const action = pending.current
    pending.current = undefined
    queueMicrotask(action)
  }, [open])
  const change = (kind: "workspace" | "branch", value: boolean) => {
    if (kind === "branch") services.branchOpen(value)
    if (value) {
      setSearch({ worktrees: "", branches: "" })
      services.search("")
    }
    if (!value && !pending.current) pending.current = services.done
    setOpen((previous) => ({ ...previous, [kind]: value, existing: false }))
  }
  const closeThen = (action: () => void, done = true) => {
    services.branchOpen(false)
    pending.current = () => {
      action()
      if (done) services.done()
    }
    setOpen({ workspace: false, existing: false, branch: false })
  }
  const icon = view.selected === "main" ? "monitor" : view.selected === "create" ? "plus" : "outline-worktree"
  const side = view.summary ? (view.direction === "rtl" ? "right" : "left") : "bottom"
  const triggerClass = view.summary
    ? "session-summary-row w-full justify-start"
    : "max-w-[203px] justify-start gap-1.5 text-ink-muted"
  const worktrees = view.workspaces.filter((item) =>
    item.name.toLowerCase().includes(search.worktrees.trim().toLowerCase()),
  )
  const item = (value: string, label: string, icon: string, description?: string) => (
    <ListRow
      role="menuitem"
      className="w-full"
      size="sm"
      leading={<Icon name={icon} />}
      trailing={view.selected === value && <Icon name="check" size="small" />}
      aria-description={description}
      onClick={() => closeThen(() => services.select(value))}
    >
      <span className="min-w-0 truncate">{label}</span>
    </ListRow>
  )
  return (
    <>
      {!view.summary && <span className="mx-1 hidden select-none opacity-50 sm:inline">/</span>}
      <Tooltip
        content={
          view.onboarding
            ? `${language.t("workspace.onboarding.title")}\n${language.t("workspace.onboarding.description")}`
            : language.t("session.new.workspace.trigger.tooltip")
        }
        child={({ props: trigger }) => (
          <span {...trigger} className={view.summary ? "inline-flex min-w-0 w-full" : "inline-flex min-w-0"}>
            <Popover
              triggerLabel={view.label}
              contentLabel={language.t("session.new.workspace.runIn")}
              open={open.workspace}
              onOpenChange={(value) => change("workspace", value)}
              variant="ghost"
              size="sm"
              side={side}
              align={view.summary ? "start" : "center"}
              sideOffset={4}
              triggerClass={triggerClass}
              trigger={
                <>
                  <Icon name={icon} className="shrink-0 text-ink-muted" />
                  <span className={view.summary ? "session-summary-label" : "min-w-0 truncate"}>{view.label}</span>
                  {view.onboarding && (
                    <span
                      data-slot="workspace-onboarding-dot"
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-feedback-info-foreground"
                    />
                  )}
                  <Icon
                    name={view.summary ? "fill-triangle-down" : "chevron-down"}
                    className="session-summary-menu-indicator shrink-0 text-ink-muted"
                  />
                </>
              }
              className="w-[220px] max-w-[calc(100vw-24px)] p-1"
            >
              {open.workspace && (
                <WorkspaceMenu label={language.t("session.new.workspace.runIn")}>
                  <div className="px-2 py-1 text-eyebrow uppercase text-ink-muted">
                    {language.t("session.new.workspace.runIn")}
                  </div>
                  {item(
                    "main",
                    language.t("session.new.workspace.local"),
                    "monitor",
                    language.t("session.new.workspace.local.tooltip"),
                  )}
                  {item("create", language.t("workspace.new"), "plus", language.t("session.new.workspace.new.tooltip"))}
                  {!!view.workspaces.length && (
                    <>
                      <hr className="my-1 border-muted" />
                      <div
                        className="contents"
                        onKeyDown={(event) => {
                          if (event.target instanceof HTMLInputElement) return
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                          event.preventDefault()
                          event.stopPropagation()
                          setOpen((previous) => ({
                            ...previous,
                            existing: event.key === (view.direction === "rtl" ? "ArrowLeft" : "ArrowRight"),
                          }))
                        }}
                      >
                        <Popover
                          open={open.existing}
                          onOpenChange={(value) => setOpen((previous) => ({ ...previous, existing: value }))}
                          triggerLabel={language.t("session.new.workspace.existingLabel")}
                          contentLabel={language.t("session.new.workspace.existingLabel")}
                          variant="ghost"
                          size="sm"
                          side={view.direction === "rtl" ? "left" : "right"}
                          align="start"
                          triggerClass="w-full justify-start"
                          trigger={
                            <>
                              <Icon name="outline-worktree" />
                              <span className="min-w-0 flex-1 truncate text-start">
                                {language.t("session.new.workspace.existingLabel")}
                              </span>
                              <Icon name={view.direction === "rtl" ? "chevron-left" : "chevron-right"} size="small" />
                            </>
                          }
                          className="flex w-[240px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-1"
                        >
                          {open.existing && (
                            <WorkspaceMenu label={language.t("session.new.workspace.existingLabel")}>
                              {view.workspaces.length >= 10 && (
                                <Input
                                  type="search"
                                  controlSize="sm"
                                  autoFocus
                                  value={search.worktrees}
                                  onValueChange={(value) =>
                                    setSearch((previous) => ({ ...previous, worktrees: value }))
                                  }
                                  placeholder={language.t("session.new.workspace.search.placeholder")}
                                  aria-label={language.t("session.new.workspace.search.placeholder")}
                                />
                              )}
                              <ScrollArea
                                label={language.t("session.new.workspace.existingLabel")}
                                variant="plain"
                                className="max-h-[min(320px,calc(100dvh-160px))]"
                              >
                                {worktrees.map((worktree) => (
                                  <div key={worktree.directory}>
                                    {item(worktree.directory, worktree.name, "outline-worktree")}
                                  </div>
                                ))}
                                {search.worktrees.trim() && !worktrees.length && (
                                  <div role="status" className="px-3 py-4 text-center text-body text-ink-muted">
                                    {language.t("session.new.workspace.search.empty")}
                                  </div>
                                )}
                              </ScrollArea>
                              <hr className="my-1 border-muted" />
                              <ListRow
                                role="menuitem"
                                size="sm"
                                className="w-full"
                                onClick={() => closeThen(services.viewAll, false)}
                              >
                                {language.t("common.viewAll")}
                              </ListRow>
                            </WorkspaceMenu>
                          )}
                        </Popover>
                      </div>
                    </>
                  )}
                </WorkspaceMenu>
              )}
            </Popover>
          </span>
        )}
      />
      {view.selected === "create" && view.branch ? (
        <Popover
          triggerLabel={language.t(view.summary ? "session.summary.basedOn" : "session.new.workspace.fromBranch", {
            branch: view.branch,
          })}
          contentLabel={language.t("session.new.workspace.branch.search.placeholder")}
          open={open.branch}
          onOpenChange={(value) => change("branch", value)}
          variant="ghost"
          size="sm"
          side={side}
          align={view.summary ? "start" : "center"}
          sideOffset={4}
          triggerClass={
            view.summary
              ? "session-summary-row w-full justify-start"
              : "ms-1 max-w-[220px] justify-start gap-1.5 text-ink-muted"
          }
          trigger={
            <>
              <Icon name="branch-out" size={view.summary ? "normal" : "small"} />
              <span className={view.summary ? "session-summary-label" : "min-w-0 truncate"}>
                {language.t(view.summary ? "session.summary.basedOn" : "session.new.workspace.fromBranch", {
                  branch: view.branch,
                })}
              </span>
              <Icon
                name={view.summary ? "fill-triangle-down" : "chevron-down"}
                className="session-summary-menu-indicator shrink-0"
              />
            </>
          }
          className="w-[260px] max-w-[calc(100vw-24px)] overflow-hidden p-1"
        >
          {open.branch && (
            <WorkspaceMenu label={language.t("session.new.workspace.branch.search.placeholder")}>
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  type="search"
                  controlSize="sm"
                  value={search.branches}
                  onValueChange={(value) => {
                    setSearch((previous) => ({ ...previous, branches: value }))
                    services.search(value)
                  }}
                  placeholder={language.t("session.new.workspace.branch.search.placeholder")}
                  aria-label={language.t("session.new.workspace.branch.search.placeholder")}
                />
                {search.branches && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={language.t("common.clear")}
                    onClick={() => {
                      setSearch((previous) => ({ ...previous, branches: "" }))
                      services.search("")
                    }}
                  >
                    <Icon name="circle-xmark" size="small" />
                  </Button>
                )}
              </div>
              <ScrollArea
                label={language.t("session.new.workspace.branch.search.placeholder")}
                variant="plain"
                className="max-h-56"
              >
                {view.branches.map((branch) => (
                  <ListRow
                    key={branch}
                    role="menuitemradio"
                    aria-checked={view.branch === branch}
                    size="sm"
                    className="w-full"
                    trailing={view.branch === branch && <Icon name="check" size="small" />}
                    onClick={() => closeThen(() => services.create(branch))}
                  >
                    <span className="min-w-0 truncate">{branch}</span>
                  </ListRow>
                ))}
              </ScrollArea>
            </WorkspaceMenu>
          )}
        </Popover>
      ) : view.summary ? (
        view.branch && (
          <div className="session-summary-row">
            <Icon name="branch" className="shrink-0 text-ink-muted" />
            <span dir="auto" className="session-summary-label">
              {view.branch}
            </span>
          </div>
        )
      ) : view.branch ? (
        <GitStatusLabel
          label={
            view.selected === "create"
              ? language.t("session.new.workspace.fromBranch", { branch: view.branch })
              : view.branch
          }
          icon={view.selected === "create" ? "branch-out" : "branch"}
          className="ms-1"
        />
      ) : null}
    </>
  )
}

function WorkspaceMenu(props: { label: string; children: ReactNode }) {
  return (
    <div role="menu" aria-label={props.label} onKeyDown={moveMenuFocus}>
      {props.children}
    </div>
  )
}

export function GitStatus(props: { source: ReturnType<typeof createGitStatusSource> }) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  if (!view.label) return null
  return <GitStatusLabel label={view.label} icon={view.icon} className={view.className} />
}

function GitStatusLabel(props: { label: string; icon: string; className?: string }) {
  const element = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    const update = () => {
      if (element.current) setTruncated(element.current.scrollWidth > element.current.clientWidth)
    }
    const observer = new ResizeObserver(update)
    if (element.current) observer.observe(element.current)
    update()
    return () => observer.disconnect()
  }, [props.label])
  return (
    <Tooltip
      disabled={!truncated}
      content={props.label}
      child={({ props: trigger }) => (
        <span
          {...trigger}
          className={`flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 px-2 text-body text-ink-muted ${props.className ?? ""}`}
        >
          <Icon name={props.icon} size="small" className="shrink-0" />
          <span ref={element} className="min-w-0 truncate">
            {props.label}
          </span>
        </span>
      )}
    />
  )
}
