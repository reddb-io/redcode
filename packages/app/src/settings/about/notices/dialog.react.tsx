/** @jsxImportSource react */
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import type { SettingsLanguage } from "../../shared.react"
import { fonts } from "./fonts"
import { crateNotices, notices } from "./notices"

const licenseOf = new Map(crateNotices.texts.map((text) => [text.id, text.license]))
const texts = crateNotices.texts.map((text) => ({
  ...text,
  crates: [...new Set(crateNotices.crates.filter((crate) => crate.texts.includes(text.id)).map((crate) => crate.name))],
}))

export default function DialogThirdPartyNotices(props: { language: SettingsLanguage; onClose: () => void }) {
  return (
    <Dialog
      open
      title={props.language.t("settings.about.notices.title")}
      description={props.language.t("settings.about.notices.description")}
      size="lg"
      className="settings-notices-dialog"
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      header={({ close }) => (
        <div className="flex items-center justify-between gap-4">
          <span className="text-heading">{props.language.t("settings.about.notices.title")}</span>
          <Button variant="ghost" size="sm" onClick={close}>
            {props.language.close}
          </Button>
        </div>
      )}
    >
      <div className="settings-notices">
        {notices.map((entry) => (
          <section key={entry.name} className="settings-notice">
            <div className="settings-notice-heading">
              <a href={entry.url} target="_blank" rel="noopener noreferrer">
                {entry.name}
              </a>
              <span>{entry.license}</span>
            </div>
            <p>{entry.detailKey ? props.language.t(entry.detailKey) : entry.detail}</p>
            {entry.notice && <pre>{entry.notice}</pre>}
            <details>
              <summary>{props.language.t("settings.about.notices.license")}</summary>
              <pre>{entry.text}</pre>
            </details>
          </section>
        ))}
        <section className="settings-notice settings-crates">
          <h3 className="settings-notice-heading">{props.language.t("settings.about.notices.fonts.title")}</h3>
          <p>{props.language.t("settings.about.notices.fonts.description")}</p>
          <ul className="settings-crate-list">
            {fonts.families.map((family) => (
              <li key={family.name} className="settings-crate">
                <div className="settings-crate-heading">
                  <a href={family.url} target="_blank" rel="noopener noreferrer">
                    {family.name}
                  </a>
                </div>
                <p>{family.copyright.join("\n")}</p>
              </li>
            ))}
          </ul>
          <details>
            <summary>SIL Open Font License 1.1</summary>
            <pre>{fonts.license}</pre>
          </details>
        </section>
        <section className="settings-notice settings-crates">
          <h3 className="settings-notice-heading">{props.language.t("settings.about.notices.crates.title")}</h3>
          <p>{props.language.t("settings.about.notices.crates.description")}</p>
          <ul className="settings-crate-list">
            {crateNotices.crates.map((crate) => {
              const applied = new Set(crate.texts.map((id) => licenseOf.get(id)))
              return (
                <li key={`${crate.name}@${crate.version}`} className="settings-crate">
                  <div className="settings-crate-heading">
                    <span>
                      <a href={crate.repository} target="_blank" rel="noopener noreferrer">
                        {crate.name}
                      </a>{" "}
                      {crate.version}
                    </span>
                    <span>
                      {crate.license
                        .split(/([\s()]+)/)
                        .map((part, index) => (applied.has(part) ? <strong key={index}>{part}</strong> : part))}
                    </span>
                  </div>
                  <p>{crate.copyright.join("\n")}</p>
                </li>
              )
            })}
          </ul>
          <h4>{props.language.t("settings.about.notices.crates.licenses")}</h4>
          {texts.map((text) => (
            <details key={text.id}>
              <summary>
                {text.title}
                <span>{props.language.plural("settings.about.notices.crates.count", text.crates.length)}</span>
              </summary>
              <p>
                {props.language.t("settings.about.notices.crates.appliesTo", {
                  names: props.language.list(text.crates),
                })}
              </p>
              <pre>{text.text}</pre>
            </details>
          ))}
        </section>
      </div>
    </Dialog>
  )
}
