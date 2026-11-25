/** @jsxImportSource react */
import { SettingsRow } from "@reddb-io/design-system/app/SettingsRow"
import { Input } from "@reddb-io/design-system/base/Input"

export function PairingAddress(props: {
  title: string
  description: string
  placeholder: string
  value: string
  error?: string
  update: (value: string) => void
  save: () => void
}) {
  return (
    <SettingsRow label={props.title} description={props.description} error={props.error}>
      {(control) => (
        <Input
          {...control}
          className="w-full"
          type="url"
          dir="ltr"
          spellCheck={false}
          autoCapitalize="off"
          placeholder={props.placeholder}
          value={props.value}
          onValueChange={props.update}
          onBlur={props.save}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.save()
          }}
        />
      )}
    </SettingsRow>
  )
}
