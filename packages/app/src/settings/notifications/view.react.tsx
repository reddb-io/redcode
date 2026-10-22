/** @jsxImportSource react */
import { Select } from "@reddb-io/design-system/base/Select"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { SettingsHeader, SettingsList, SettingsRow, type SettingsLanguage } from "../shared.react"

export function Notifications(props: {
  language: SettingsLanguage
  channels: {
    kind: "agent" | "permissions" | "errors"
    checked: boolean
    onChange: (value: boolean) => void
    sound: string
    onSoundChange: (value: string) => void
  }[]
  sounds: { value: string; label: string }[]
}) {
  return (
    <>
      <SettingsHeader
        title={props.language.t("settings.tab.notifications")}
        description={props.language.t("settings.notifications.description")}
      />
      <div className="settings-tab-body settings-tab-body--sectioned">
        <div className="settings-section">
          <h3 className="settings-section-title">{props.language.t("settings.general.section.notifications")}</h3>
          <SettingsList>
            {props.channels.map((channel) => (
              <SettingsRow
                key={channel.kind}
                title={props.language.t(`settings.general.notifications.${channel.kind}.title`)}
                description={props.language.t(`settings.general.notifications.${channel.kind}.description`)}
              >
                {(association) => (
                  <div data-action={`settings-notifications-${channel.kind}`}>
                    <Switch
                      {...association}
                      label={props.language.t(`settings.general.notifications.${channel.kind}.title`)}
                      fieldClass="settings-react-switch"
                      checked={channel.checked}
                      onCheckedChange={channel.onChange}
                    />
                  </div>
                )}
              </SettingsRow>
            ))}
          </SettingsList>
        </div>
        <div className="settings-section">
          <h3 className="settings-section-title">{props.language.t("settings.general.section.sounds")}</h3>
          <SettingsList>
            {props.channels.map((channel) => (
              <SettingsRow
                key={channel.kind}
                title={props.language.t(`settings.general.sounds.${channel.kind}.title`)}
                description={props.language.t(`settings.general.sounds.${channel.kind}.description`)}
              >
                {(association) => (
                  <Select
                    {...association}
                    data-action={`settings-sounds-${channel.kind}`}
                    controlSize="sm"
                    options={props.sounds}
                    value={channel.sound}
                    onValueChange={channel.onSoundChange}
                  />
                )}
              </SettingsRow>
            ))}
          </SettingsList>
        </div>
      </div>
    </>
  )
}
