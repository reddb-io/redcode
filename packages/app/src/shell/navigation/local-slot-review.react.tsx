/** @jsxImportSource react */
import { ChangeReview } from "@reddb-io/design-system/app/ChangeReview"
import type { SharedLanguage } from "@/runtime/react/language"

export function LocalSlotReview(props: {
  directory: string
  language: SharedLanguage
  busy: boolean
  approve: () => void
  cancel: () => void
}) {
  const language = props.language
  return (
    <ChangeReview
      title={language.t("agentWorktrees.localReview")}
      items={[
        {
          id: "checkout",
          label: props.directory,
          before: language.t("agentWorktrees.slotDisabled"),
          after: language.t("agentWorktrees.slotEnabled"),
          state: props.busy ? "applying" : "pending",
        },
      ]}
      applying={props.busy}
      onapplyrequest={props.approve}
      ondiscardrequest={props.cancel}
      beforeLabel={language.t("agentWorktrees.before")}
      afterLabel={language.t("agentWorktrees.after")}
      applyLabel={language.t("agentWorktrees.enableLocal")}
      discardLabel={language.t("common.cancel")}
      discardItemLabel={language.t("common.cancel")}
      pendingLabel={language.t("agentTasks.stage.upcoming")}
      applyingLabel={language.t("agentTasks.stage.current")}
      appliedLabel={language.t("agentTasks.stage.complete")}
      failedLabel={language.t("agentTasks.stage.failed")}
    />
  )
}
