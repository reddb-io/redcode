/** @jsxImportSource react */
import { SettingsRow } from "@reddb-io/design-system/app/SettingsRow"
import { switchControl } from "@reddb-io/design-system/base/recipes"

export function SettingsSwitchRow(props: {
  action: string
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <SettingsRow label={props.title} description={props.description}>
      {(control) => (
        <input
          {...control}
          data-action={props.action}
          type="checkbox"
          role="switch"
          className={switchControl({ class: "block @sm/settings-row:ms-auto" })}
          checked={props.checked}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
      )}
    </SettingsRow>
  )
}
