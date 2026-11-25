import { ReactView } from "@opencode/ui/react-view"
import { useExtension } from "../sdk"
import { SettingsSwitchRow } from "../settings/switch-row.react"
import type Review from "./index"

export default function WrapLinesRow() {
  const ctx = useExtension<typeof Review>()
  const mobileDiff = ctx.stores.mobileDiff

  return (
    <ReactView
      component={SettingsSwitchRow}
      props={{
        action: "settings-mobile-diff-wrap",
        title: ctx.t("settings.wrapLines.title"),
        description: ctx.t("settings.wrapLines.description"),
        checked: mobileDiff.value.wrap,
        onChange: (checked) =>
          mobileDiff.update((draft) => {
            draft.wrap = checked
          }),
      }}
    />
  )
}
