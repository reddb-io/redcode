/** @jsxImportSource react */
import { Field } from "@reddb-io/design-system/base/Field"
import { Input } from "@reddb-io/design-system/base/Input"

type ConnectionField = "target" | "name" | "user" | "port" | "identity"

export function SshConnectionFields(props: {
  values: Record<ConnectionField, string>
  labels: Record<ConnectionField, string>
  targetPlaceholder: string
  namePlaceholder: string
  optionsLabel: string
  authenticationNote: string
  disabled: boolean
  invalid: boolean
  onChange: (field: ConnectionField, value: string) => void
  onSubmit: () => void
}) {
  return (
    <div
      className="grid min-w-0 gap-6"
      onKeyDown={(event) => {
        if (!(event.target instanceof HTMLInputElement) || event.key !== "Enter" || event.nativeEvent.isComposing)
          return
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <Field id="ssh-target" label={props.labels.target}>
        {(control) => (
          <Input
            {...control}
            dir="ltr"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={props.targetPlaceholder}
            aria-invalid={props.invalid || undefined}
            disabled={props.disabled}
            value={props.values.target}
            onValueChange={(value) => props.onChange("target", value)}
          />
        )}
      </Field>
      <Field id="ssh-name" label={props.labels.name}>
        {(control) => (
          <Input
            {...control}
            dir="auto"
            placeholder={props.namePlaceholder}
            disabled={props.disabled}
            value={props.values.name}
            onValueChange={(value) => props.onChange("name", value)}
          />
        )}
      </Field>
      <details>
        <summary className="cursor-pointer py-2 text-label">{props.optionsLabel}</summary>
        <div className="grid min-w-0 gap-3 pt-2">
          {(["user", "port", "identity"] as const).map((field) => (
            <Field key={field} id={`ssh-${field}`} label={props.labels[field]}>
              {(control) => (
                <Input
                  {...control}
                  size="sm"
                  autoComplete="off"
                  spellCheck={field === "identity" ? false : undefined}
                  inputMode={field === "port" ? "numeric" : undefined}
                  placeholder={field === "port" ? "22" : undefined}
                  disabled={props.disabled}
                  value={props.values[field]}
                  onValueChange={(value) => props.onChange(field, value)}
                />
              )}
            </Field>
          ))}
          <p className="text-caption text-ink-muted">{props.authenticationNote}</p>
        </div>
      </details>
    </div>
  )
}
