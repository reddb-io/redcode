/** @jsxImportSource react */
import { SettingsRow } from "@reddb-io/design-system/app/SettingsRow"
import { Button } from "@reddb-io/design-system/base/Button"
import { SettingsSwitchRow } from "../settings/switch-row.react"

export function UpdateSettings(props: {
  heading: string
  notesTitle: string
  notesDescription: string
  enabled: boolean
  toggle: (checked: boolean) => void
  checkTitle: string
  checkDescription: string
  checkLabel: string
  disabled: boolean
  run: () => void
}) {
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{props.heading}</h3>
      <div data-component="settings-list">
        <SettingsSwitchRow
          action="settings-release-notes"
          title={props.notesTitle}
          description={props.notesDescription}
          checked={props.enabled}
          onChange={props.toggle}
        />
        <SettingsRow
          label={props.checkTitle}
          description={props.checkDescription}
          actions={
            <Button data-action="settings-check-updates" disabled={props.disabled} onClick={props.run}>
              {props.checkLabel}
            </Button>
          }
        />
      </div>
    </div>
  )
}
