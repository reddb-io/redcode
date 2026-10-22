import type { SearchSelectOption } from "@reddb-io/design-system/base/recipes"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedSource } from "./source"
import { sharedLanguage } from "./language"
import { ReactView } from "./view"
import { SearchSelectView } from "./search-select.react"

export function SearchSelect(props: {
  label: string
  options: readonly SearchSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  class?: string
}) {
  const language = useLanguage()
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    label: props.label,
    options: props.options.map((option) => ({ ...option })),
    value: props.value,
    placeholder: props.placeholder,
    disabled: props.disabled,
    className: props.class,
  }))
  return (
    <ReactView component={SearchSelectView} props={{ source, onChange: (value: string) => props.onChange(value) }} />
  )
}
