import { ReactView } from "@opencode/ui/react-view"
import type { SearchSelectOption } from "@reddb-io/design-system/base/recipes"
import { useExtension } from "../sdk"
import { SourcePicker } from "./source-picker.react"

export function PublishedSource(props: {
  label: string
  options: readonly SearchSelectOption[]
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const ctx = useExtension()
  return (
    <ReactView
      component={SourcePicker}
      props={{
        label: props.label,
        options: props.options,
        value: props.value,
        disabled: props.disabled,
        onChange: props.onChange,
        searchLabel: ctx.t("ui.searchSelect.search"),
        emptyLabel: ctx.t("ui.searchSelect.empty"),
        previousLabel: ctx.t("ui.common.back"),
        nextLabel: ctx.t("ui.common.next"),
      }}
    />
  )
}
