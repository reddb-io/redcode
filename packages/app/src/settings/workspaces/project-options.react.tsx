/** @jsxImportSource react */
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import type { LocalProject } from "@/shell/state/layout"
import type { createProjectActions } from "./project-actions"
import type { SettingsLanguage } from "../shared.react"
import { SettingsIcon } from "../icon.react"

export function ProjectOptions(props: {
  project: LocalProject
  language: SettingsLanguage
  actions: ReturnType<typeof createProjectActions>
  presentation: ReturnType<ReturnType<typeof createProjectActions>["presentation"]>
  unseen: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit?: () => void
  onRename?: () => void
  onClose?: () => void
}) {
  const language = props.language
  return (
    <DropdownMenu
      triggerLabel={language.t("common.moreOptions")}
      contentLabel={language.t("common.moreOptions")}
      open={props.open}
      onOpenChange={props.onOpenChange}
      trigger={<SettingsIcon name="outline-dots" />}
      variant="ghost"
      size="sm"
      align="end"
      items={[
        {
          items: [
            ...(props.onEdit ? [{ id: "edit", label: language.t("common.edit"), onselect: props.onEdit }] : []),
            ...(props.onRename ? [{ id: "rename", label: language.t("common.rename"), onselect: props.onRename }] : []),
            ...(props.presentation.reveal
              ? [
                  {
                    id: "reveal",
                    label: props.presentation.revealLabel,
                    onselect: () => props.actions.reveal(props.project),
                  },
                ]
              : []),
            {
              id: "clear",
              label: language.t("sidebar.project.clearNotifications"),
              disabled: !props.unseen,
              onselect: () => props.actions.clear(props.project),
            },
          ],
        },
        {
          items: [
            {
              id: "close",
              label: language.t("common.close"),
              onselect: () => {
                props.actions.close(props.project)
                props.onClose?.()
              },
            },
          ],
        },
      ]}
    />
  )
}
