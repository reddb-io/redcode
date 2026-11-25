/** @jsxImportSource react */
import { Field } from "@reddb-io/design-system/base/Field"
import { Input } from "@reddb-io/design-system/base/Input"

export function CreatorInput(props: {
  label: string
  type?: "search" | "text"
  hideLabel?: boolean
  help?: string
  placeholder?: string
  disabled?: boolean
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={props.label} help={props.help} className={props.hideLabel ? "gap-0 [&>label]:sr-only" : undefined}>
      {(control) => (
        <Input
          {...control}
          type={props.type}
          size="sm"
          placeholder={props.placeholder}
          disabled={props.disabled}
          value={props.value}
          onValueChange={props.onChange}
        />
      )}
    </Field>
  )
}
