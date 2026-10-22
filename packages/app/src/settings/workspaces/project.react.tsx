/** @jsxImportSource react */
import { useState, useSyncExternalStore } from "react"
import { Input } from "@reddb-io/design-system/base/Input"
import { Textarea } from "@reddb-io/design-system/base/Textarea"
import { displayName, getProjectAvatarVariant, PROJECT_AVATAR_VARIANTS } from "@opencode/ui/project-avatar-data"
import { SettingsList, SettingsRow } from "../shared.react"
import { SettingsIcon } from "../icon.react"
import { ProjectTile } from "./project-tile.react"
import { ProjectOptions } from "./project-options.react"
import { createEditProjectModel } from "./project-model"
import type { createProjectGeneralServices } from "./project"
import "./project.css"

type Services = ReturnType<typeof createProjectGeneralServices>
export function ProjectGeneral(props: { services: Services }) {
  const snapshot = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  return (
    <ProjectEditor
      key={`${snapshot.serverKey}:${snapshot.project.worktree}`}
      services={props.services}
      snapshot={snapshot}
    />
  )
}
function ProjectEditor(props: { services: Services; snapshot: ReturnType<Services["snapshot"]["getSnapshot"]> }) {
  const services = props.services
  const snapshot = props.snapshot
  const language = snapshot.language
  const project = snapshot.project
  const [model] = useState(() =>
    createEditProjectModel({
      project,
      persist: (patch) => services.actions.persist(project, patch),
      notify: services.actions.notify,
    }),
  )
  const state = useSyncExternalStore(model.source.subscribe, model.source.getSnapshot)
  const tile = {
    ...project,
    name: state.name || model.defaultName(),
    icon: { color: state.color, url: project.icon?.url, override: state.iconOverride },
  }
  return (
    <>
      <div className="settings-tab-header">
        <div className="settings-tab-header-row">
          <div className="flex min-w-0 items-center gap-3">
            <ProjectTile project={tile} size="xl" />
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="settings-tab-title truncate">
                <bdi dir="auto">{state.name || displayName(project)}</bdi>
              </h2>
              {snapshot.multiple && (
                <button type="button" className="project-settings-server-link" onClick={services.onOpenServer}>
                  <bdi dir="auto">{snapshot.serverName}</bdi>
                </button>
              )}
            </div>
          </div>
          <ProjectOptions
            project={project}
            language={language}
            actions={services.actions}
            presentation={snapshot.presentation}
            unseen={snapshot.unseen}
            onClose={services.onClose}
          />
        </div>
      </div>
      <div className="settings-tab-body project-settings-general" aria-busy={state.saving > 0}>
        <SettingsList>
          <SettingsRow
            title={language.t("project.settings.name.title")}
            description={language.t("project.settings.name.description")}
          >
            {(association) => (
              <div className="project-settings-name">
                <Input
                  {...association}
                  data-action="settings-project-name"
                  type="text"
                  controlSize="sm"
                  value={state.name}
                  placeholder={model.folderName()}
                  onValueChange={(name) => model.update({ name })}
                  onBlur={model.saveName}
                />
              </div>
            )}
          </SettingsRow>
          <SettingsRow
            title={language.t("dialog.project.edit.icon")}
            description={language.t("project.settings.icon.description")}
          >
            {() => (
              <>
                <button
                  data-action="settings-project-icon"
                  type="button"
                  aria-label={language.t("dialog.project.edit.icon.alt")}
                  className={`project-settings-icon${state.dragOver ? " project-settings-icon--active" : ""}`}
                  onMouseEnter={() => model.update({ iconHover: true })}
                  onMouseLeave={() => model.update({ iconHover: false })}
                  onDrop={(event) => model.drop(event.nativeEvent)}
                  onDragOver={(event) => model.dragOver(event.nativeEvent)}
                  onDragLeave={model.dragLeave}
                  onClick={model.iconClick}
                >
                  <ProjectTile project={tile} size="xl" />
                  <span className={`project-settings-icon-overlay${state.iconHover ? " visible" : ""}`}>
                    <SettingsIcon name={state.iconOverride ? "close" : "share"} />
                  </span>
                </button>
                <input
                  ref={(element) => {
                    if (element) model.setIconInput(element)
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => model.inputChange(event.currentTarget)}
                />
              </>
            )}
          </SettingsRow>
          {!state.iconOverride && (
            <SettingsRow
              title={language.t("dialog.project.edit.color")}
              description={language.t("project.settings.color.description")}
            >
              {() => (
                <div className="project-settings-colors" data-action="settings-project-color">
                  {PROJECT_AVATAR_VARIANTS.filter((color) => color !== "green" && color !== "red").map((color) => {
                    const selected = !!state.color && getProjectAvatarVariant(state.color) === color
                    return (
                      <button
                        key={color}
                        type="button"
                        aria-label={language.t("dialog.project.edit.color.select", {
                          color: language.t(`common.color.${color}`),
                        })}
                        aria-pressed={selected}
                        className={`project-settings-color${selected ? " project-settings-color--selected" : ""}`}
                        onClick={() => model.setColor(selected ? undefined : color)}
                      >
                        <ProjectTile project={{ worktree: "", icon: { color } }} size="md" />
                        {selected && (
                          <SettingsIcon name="check" size="small" className="project-settings-color-check" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </SettingsRow>
          )}
          <div className="project-settings-startup">
            <div className="project-settings-startup-copy">
              <span className="project-settings-startup-title">
                {language.t("dialog.project.edit.worktree.startup")}
              </span>
              <span className="project-settings-startup-description">
                {language.t("project.settings.worktree.startup.description")}
              </span>
            </div>
            <Textarea
              className="!w-full font-mono"
              rows={5}
              value={state.startup}
              placeholder={language.t("dialog.project.edit.worktree.startup.placeholder")}
              aria-label={language.t("dialog.project.edit.worktree.startup")}
              spellCheck={false}
              onValueChange={(startup) => model.update({ startup })}
              onBlur={model.saveStartup}
            />
            <div className="project-settings-startup-hint flex flex-col">
              <span>{inlineVariables(language.t("project.settings.worktree.startup.hint.base"))}</span>
              <span>{inlineVariables(language.t("project.settings.worktree.startup.hint.new"))}</span>
            </div>
          </div>
        </SettingsList>
      </div>
    </>
  )
}
function inlineVariables(text: string) {
  return text.split(/(\$[A-Z][A-Z0-9_]*)/g).map((part, index) =>
    index % 2 === 0 ? (
      part
    ) : (
      <code key={index} dir="ltr">
        {part}
      </code>
    ),
  )
}
