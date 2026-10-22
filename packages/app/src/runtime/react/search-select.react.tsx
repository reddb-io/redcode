/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { SearchSelect } from "@reddb-io/design-system/base/SearchSelect"
import type { SearchSelectOption } from "@reddb-io/design-system/base/recipes"
import type { SharedLanguage } from "./language"
import type { SharedSource } from "./source"

export function SearchSelectView(props: {
  source: SharedSource<{
    language: SharedLanguage
    label: string
    options: readonly SearchSelectOption[]
    value: string
    placeholder?: string
    disabled?: boolean
    className?: string
  }>
  onChange: (value: string) => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return (
    <SearchSelect
      label={view.label}
      options={view.options}
      value={view.value}
      disabled={view.disabled}
      clearable={false}
      controlSize="sm"
      className={`gap-0 [&>label]:sr-only ${view.className ?? ""}`}
      triggerClass="min-h-[var(--reddb-spatial-target-min)]"
      placeholder={
        view.options.find((option) => option.value === view.value)?.label ??
        view.placeholder ??
        view.language.t("ui.searchSelect.placeholder")
      }
      searchPlaceholder={view.language.t("ui.searchSelect.search")}
      emptyText={view.language.t("ui.searchSelect.empty")}
      onValueChange={(value) => {
        if (value !== view.value) props.onChange(value)
      }}
    />
  )
}
