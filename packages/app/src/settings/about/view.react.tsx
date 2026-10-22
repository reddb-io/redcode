/** @jsxImportSource react */
import { useState, type ComponentType } from "react"
import { Logo } from "@reddb-io/design-system/base/Logo"
import type { SettingsLanguage } from "../shared.react"

export function About(props: { language: SettingsLanguage; version?: string; onNoticesFailure: () => void }) {
  const [Notices, setNotices] = useState<ComponentType<{ language: SettingsLanguage; onClose: () => void }>>()
  const showNotices = async () => {
    const loaded = await import("./notices/dialog.react").catch(() => undefined)
    if (!loaded) return props.onNoticesFailure()
    setNotices(() => loaded.default)
  }

  return (
    <div className="settings-about-content">
      <div className="settings-about-intro">
        <p>
          {props.language.t("settings.about.version", {
            version: props.version ?? props.language.t("settings.about.devVersion"),
          })}
        </p>
        <p>{props.language.t("settings.about.license")}</p>
      </div>
      <Logo />
      <p className="settings-about-faint">
        <a href="https://github.com/reddb-io/redcode" target="_blank" rel="noopener noreferrer">
          <bdi dir="ltr">{props.language.t("settings.about.website")}</bdi>
        </a>
      </p>
      <div className="settings-about-details">
        <p>{props.language.t("settings.about.redcode.description")}</p>
        <p>
          <a href="https://github.com/anomalyco/opencode" target="_blank" rel="noopener noreferrer">
            {props.language.t("settings.about.redcode.upstream")}
          </a>
        </p>
        <p>{props.language.t("settings.about.typeset")}</p>
        <p>
          <button type="button" className="settings-about-link" onClick={() => void showNotices()}>
            {props.language.t("settings.about.notices.title")}
          </button>
        </p>
      </div>
      <div className="settings-about-copyright">
        <p>{props.language.t("settings.about.redcode.copyright")}</p>
      </div>
      {Notices && <Notices language={props.language} onClose={() => setNotices(undefined)} />}
    </div>
  )
}
