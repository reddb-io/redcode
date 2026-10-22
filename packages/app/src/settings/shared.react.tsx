/** @jsxImportSource react */
import { useId, type ReactNode } from "react"

export { sharedLanguage as settingsLanguage, type SharedLanguage as SettingsLanguage } from "@/runtime/react/language"

export function SettingsHeader(props: { title: string; description: string }) {
  return (
    <div className="settings-tab-header">
      <div className="settings-tab-header-row">
        <div className="flex flex-col gap-1">
          <h2 className="settings-tab-title">{props.title}</h2>
          <span className="text-11-regular text-ink-muted">{props.description}</span>
        </div>
      </div>
    </div>
  )
}

export function SettingsList(props: { children: ReactNode; variant?: "catalog" }) {
  return (
    <div data-component="settings-list" data-variant={props.variant}>
      {props.children}
    </div>
  )
}

export function SettingsRow(props: {
  title: ReactNode
  description: ReactNode
  children: (association: { "aria-labelledby": string; "aria-describedby": string }) => ReactNode
}) {
  const id = useId()
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div id={`${id}-title`} data-slot="settings-row-title">
          {props.title}
        </div>
        <div id={`${id}-description`} data-slot="settings-row-description">
          {props.description}
        </div>
      </div>
      <div data-slot="settings-row-control">
        {props.children({ "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-description` })}
      </div>
    </div>
  )
}
