/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import { Select } from "@reddb-io/design-system/base/Select"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { getFilename } from "@opencode/util/path"
import { getRelativeTime } from "@/shell/time"
import { sessionLabel } from "@/session/title"
import { pathKey } from "@/workspaces/path-key"
import {
  filterWorkspaceInventory,
  managedWorkspaceDirectories,
  sessionsForWorkspace,
  workspaceInventory,
} from "@/workspaces/paths"
import { SettingsHeader, SettingsList, type SettingsLanguage } from "../shared.react"
import { SettingsIcon } from "../icon.react"
import { createWorkspacesController, type WorkspaceConfirmation } from "./controller"
import type { Workspace, WorkspacesServices } from "./workspaces"

type Controller = ReturnType<typeof createWorkspacesController>
export function Workspaces(props: { services: WorkspacesServices }) {
  const snapshot = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const [controller] = useState(() => createWorkspacesController(props.services))
  const state = useSyncExternalStore(controller.source.subscribe, controller.source.getSnapshot)
  const language = snapshot.language
  useEffect(() => controller.update({ project: snapshot.projectID ?? "all" }), [snapshot.projectID, snapshot.reset])
  const workspaces = workspaceInventory(snapshot.inventory)
  const projects = snapshot.inventory.filter((project) => managedWorkspaceDirectories(project).length > 0)
  const projectName = (project: Workspace["project"]) => project.name || getFilename(project.worktree)
  const selected =
    snapshot.projectID ??
    (state.project === "all" || projects.some((project) => project.id === state.project) ? state.project : "all")
  const filtered = filterWorkspaceInventory(workspaces, selected)
  const linked = (workspace: Workspace) => sessionsForWorkspace(snapshot.sessions, workspace.directory)
  const withoutSessions =
    snapshot.sessionPending || snapshot.sessionError || snapshot.sessionPlaceholder
      ? []
      : filtered.filter((workspace) => !linked(workspace).length)
  const sessionCount = (workspace: Workspace) => {
    const count = linked(workspace).length
    if (!count && snapshot.sessionPending) return language.t("session.messages.loading")
    if (!count && snapshot.sessionError) return language.t("common.requestFailed")
    if (selected !== "all") return language.plural("settings.workspaces.sessions.filtered", count, { count })
    const project = projectName(workspace.project)
    const label = language.plural("settings.workspaces.sessions", count, { count, project })
    const start = label.lastIndexOf(project)
    return start < 0 ? (
      label
    ) : (
      <>
        {label.slice(0, start)}
        <span className="settings-workspaces-meta-project">{project}</span>
        {label.slice(start + project.length)}
      </>
    )
  }
  const time = (updated: number | undefined) =>
    updated ? getRelativeTime(new Date(updated).toISOString(), language.t) : undefined
  const [menu, setMenu] = useState(false)
  return (
    <>
      <SettingsHeader
        title={language.t("settings.tab.workspaces")}
        description={language.t("settings.workspaces.description")}
      />
      <div className="settings-tab-body settings-workspaces">
        {!!filtered.length && (
          <div className="settings-workspaces-toolbar">
            <span className="settings-section-title">
              {language.plural("settings.workspaces.count", filtered.length)}
            </span>
            <div className="settings-workspaces-toolbar-actions">
              {!snapshot.projectID && projects.length > 1 && (
                <Select
                  controlSize="sm"
                  className="max-w-48"
                  aria-label={language.t("settings.workspaces.filter.all")}
                  value={selected}
                  options={[
                    { value: "all", label: language.t("settings.workspaces.filter.all") },
                    ...projects.map((project) => ({ value: project.id, label: projectName(project) })),
                  ]}
                  onValueChange={(project) => controller.update({ project })}
                />
              )}
              {state.transaction ? (
                <Button type="button" variant="ghost" size="sm" disabled aria-label={language.t("common.moreOptions")}>
                  <SettingsIcon name="outline-dots" size="small" />
                </Button>
              ) : (
                <DropdownMenu
                  triggerLabel={language.t("common.moreOptions")}
                  contentLabel={language.t("common.moreOptions")}
                  trigger={<SettingsIcon name="outline-dots" size="small" />}
                  variant="ghost"
                  size="sm"
                  align="end"
                  open={menu}
                  onOpenChange={setMenu}
                  items={[
                    ...(withoutSessions.length
                      ? [
                          {
                            items: [
                              {
                                id: "empty",
                                label: language.t("settings.workspaces.deleteWithoutSessions"),
                                onselect: () => controller.confirm("empty", withoutSessions),
                              },
                            ],
                          },
                        ]
                      : []),
                    {
                      items: [
                        {
                          id: "all",
                          label: language.t("settings.workspaces.deleteAll"),
                          onselect: () => controller.confirm("all", filtered),
                        },
                      ],
                    },
                  ]}
                />
              )}
            </div>
          </div>
        )}
        <div className="settings-workspaces-inventory" data-empty={!filtered.length}>
          <SettingsList>
            <div className="settings-workspaces-empty-motion" data-visible={!filtered.length}>
              <div className="settings-workspaces-empty">
                {snapshot.pending || snapshot.error ? (
                  language.t(snapshot.pending ? "common.loading" : "common.requestFailed")
                ) : (
                  <>
                    <span className="settings-workspaces-empty-title">{language.t("settings.workspaces.empty")}</span>
                    <span>{language.t("settings.workspaces.empty.description")}</span>
                  </>
                )}
              </div>
            </div>
            {filtered.map((workspace) => {
              const key = String(pathKey(workspace.directory))
              const sessions = linked(workspace)
              const last = time(sessions[0]?.time.updated)
              return (
                <div
                  key={`${workspace.project.id}:${key}`}
                  className="settings-workspaces-row-motion"
                  data-removing={state.removing.includes(key)}
                >
                  <div className="settings-workspaces-row">
                    <div className="settings-workspaces-row-header">
                      <div className="settings-workspaces-copy">
                        <div className="settings-workspaces-main">
                          <WorkspacePath directory={workspace.directory} />
                        </div>
                        <span className="settings-workspaces-meta">{sessionCount(workspace)}</span>
                      </div>
                      <div className="settings-workspaces-row-actions">
                        {state.deleting.includes(key) ? (
                          <span className="settings-workspaces-active">
                            {language.t("workspace.lifecycle.deleting")}
                          </span>
                        ) : (
                          <>
                            {last && (
                              <Tooltip
                                label={language.t("settings.workspaces.lastActiveSession")}
                                content={language.t("settings.workspaces.lastActiveSession")}
                                child={({ props }) => (
                                  <span {...props} tabIndex={0} className="settings-workspaces-active">
                                    {last}
                                  </span>
                                )}
                              />
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={language.t("workspace.delete.confirm", {
                                name: getFilename(workspace.directory),
                              })}
                              disabled={!!state.transaction}
                              onClick={() => controller.confirm("single", [workspace])}
                            >
                              <SettingsIcon name="outline-trash" size="small" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {!!sessions.length && (
                      <div className="settings-workspaces-sessions">
                        {sessions.map((session) => (
                          <div key={session.id} className="settings-workspaces-session">
                            <span>{sessionLabel(session)}</span>
                            {sessions.length > 1 && time(session.time.updated) && (
                              <span className="settings-workspaces-session-time">{time(session.time.updated)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </SettingsList>
        </div>
      </div>
      {state.confirmation && (
        <DeleteDialog confirmation={state.confirmation} controller={controller} language={language} />
      )}
    </>
  )
}
function WorkspacePath(props: { directory: string }) {
  const [truncated, setTruncated] = useState(false)
  const element = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const update = () => {
      if (element.current) setTruncated(element.current.scrollWidth > element.current.clientWidth)
    }
    update()
    const observer = new ResizeObserver(update)
    if (element.current) observer.observe(element.current)
    return () => observer.disconnect()
  }, [props.directory])
  const name = getFilename(props.directory)
  return (
    <Tooltip
      label={props.directory}
      content={props.directory}
      disabled={!truncated}
      child={({ props: trigger }) => (
        <span
          {...trigger}
          ref={element}
          tabIndex={truncated ? 0 : undefined}
          dir="ltr"
          aria-label={props.directory}
          className="settings-workspaces-path"
        >
          <span>{props.directory.slice(0, -name.length)}</span>
          <span className="settings-workspaces-path-name">{name}</span>
        </span>
      )}
    />
  )
}
function DeleteDialog(props: {
  confirmation: WorkspaceConfirmation
  controller: Controller
  language: SettingsLanguage
}) {
  const confirmation = props.confirmation
  const language = props.language
  const [inspection, setInspection] = useState<Awaited<ReturnType<WorkspaceConfirmation["context"]["inspect"]>>>()
  const [error, setError] = useState(false)
  useEffect(() => {
    if (confirmation.kind !== "single") return
    const owner = { active: true }
    void confirmation.context.inspect(confirmation.inventory[0]).then(
      (result) => {
        if (owner.active) setInspection(result)
      },
      () => {
        if (owner.active) setError(true)
      },
    )
    return () => {
      owner.active = false
    }
  }, [confirmation])
  const single = confirmation.kind === "single"
  const pending = single && !inspection && !error
  const title = language.t(
    single
      ? "workspace.delete.confirm"
      : confirmation.kind === "all"
        ? "settings.workspaces.deleteAll"
        : "settings.workspaces.deleteWithoutSessions",
    { name: getFilename(confirmation.inventory[0].directory) },
  )
  const descriptions = error
    ? [language.t("workspace.status.error")]
    : inspection
      ? props.controller.inspectionMessages(inspection.result)
      : []
  return (
    <Dialog
      open
      title={title}
      onOpenChange={(open) => {
        if (!open) props.controller.cancel()
      }}
      header={({ close }) => (
        <div className="flex items-center justify-between gap-4">
          <span className="text-heading">{title}</span>
          <Button variant="ghost" size="sm" onClick={close}>
            {language.close}
          </Button>
        </div>
      )}
      actions={() => (
        <>
          <Button onClick={props.controller.cancel}>{language.t("common.cancel")}</Button>
          <Button tone="danger" disabled={pending || error} onClick={() => void props.controller.remove()}>
            {language.t(single ? "workspace.delete.button" : "settings.workspaces.delete.button")}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        {single ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-11-regular text-ink-muted">
                {language.t(pending ? "workspace.status.checking" : "workspace.delete.location")}
              </span>
              <code className="block w-fit max-w-full rounded-sm bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-foreground break-all">
                {confirmation.inventory[0].directory}
              </code>
            </div>
            <div>{language.t("settings.workspaces.delete.warning")}</div>
            {descriptions.map((description) => (
              <div key={description}>{description}</div>
            ))}
          </>
        ) : (
          <>
            <div>
              {language.plural(
                confirmation.kind === "all"
                  ? "settings.workspaces.deleteAll.confirm"
                  : "settings.workspaces.deleteWithoutSessions.confirm",
                confirmation.inventory.length,
              )}
            </div>
            <div>
              {language.t(
                confirmation.kind === "all"
                  ? "settings.workspaces.deleteAll.warning"
                  : "settings.workspaces.deleteWithoutSessions.warning",
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
