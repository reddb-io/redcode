/** @jsxImportSource react */
import { useEffect, useState, useSyncExternalStore } from "react"
import type { SharedSource } from "@/runtime/react/source"
import { createSoundPreviewController } from "../general/behavior"
import { playSoundById, SOUND_OPTIONS } from "@/shell/notifications/sound"
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

export function NotificationSettings(props: {
  services: {
    snapshot: SharedSource<{
      language: SettingsLanguage
      channels: { kind: "agent" | "permissions" | "errors"; checked: boolean; enabled: boolean; sound: string }[]
    }>
    actions: Record<
      "agent" | "permissions" | "errors",
      { notify: (value: boolean) => void; enable: (value: boolean) => void; sound: (value: string) => void }
    >
  }
}) {
  const state = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const [preview] = useState(() => createSoundPreviewController(playSoundById))
  useEffect(() => preview.stop, [preview])
  const options = [{ id: "none", label: "sound.option.none" } as const, ...SOUND_OPTIONS]
  return (
    <Notifications
      language={state.language}
      sounds={options.map((option) => ({ value: option.id, label: state.language.t(option.label) }))}
      channels={state.channels.map((channel) => ({
        kind: channel.kind,
        checked: channel.checked,
        onChange: props.services.actions[channel.kind].notify,
        sound: channel.enabled ? (options.find((option) => option.id === channel.sound)?.id ?? "none") : "none",
        onSoundChange(value) {
          const option = options.find((option) => option.id === value)
          if (!option) return
          props.services.actions[channel.kind].enable(option.id !== "none")
          if (option.id === "none") {
            preview.stop()
            return
          }
          props.services.actions[channel.kind].sound(option.id)
          preview.play(option.id)
        },
      }))}
    />
  )
}
