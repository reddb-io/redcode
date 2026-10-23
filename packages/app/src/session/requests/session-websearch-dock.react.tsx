/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Select } from "@reddb-io/design-system/base/Select"
import { SettingsRow } from "@/settings/shared.react"
import "@/settings/settings.css"
import type { createSessionWebSearchServices } from "./session-websearch-dock"

export function SessionWebSearchDockView(props: { services: ReturnType<typeof createSessionWebSearchServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  return (
    <section
      data-component="session-websearch-dock"
      aria-label={language.t("session.websearch.title")}
      aria-busy={view.sending}
    >
      <div data-dock-surface="shell" className="websearch-body">
        <div className="websearch-setting">
          <SettingsRow
            title={language.t("session.websearch.title")}
            description={language.t("session.websearch.description")}
          >
            {(association) => (
              <Select
                aria-label={language.t("session.websearch.provider")}
                aria-describedby={association["aria-describedby"]}
                value={view.selected ?? ""}
                options={view.options}
                onValueChange={services.select}
                disabled={view.busy || view.unavailable}
                className="max-w-full"
              >
                {!view.current && (
                  <option value="" disabled>
                    {language.t("session.websearch.provider")}
                  </option>
                )}
              </Select>
            )}
          </SettingsRow>
        </div>
      </div>
      <div data-dock-surface="tray" data-dock-attach="top" className="websearch-footer">
        <div className="websearch-status" aria-live="polite">
          {view.loadFailed ? (
            <>
              <span>{language.t("session.websearch.loadFailed")}</span>
              <Button variant="ghost" size="sm" onClick={services.retry} disabled={view.busy}>
                {language.t("session.websearch.retry")}
              </Button>
            </>
          ) : (
            view.status
          )}
        </div>
        <div className="websearch-actions">
          {!view.specific && (
            <Button variant="ghost" size="sm" onClick={services.decline} disabled={view.busy}>
              {language.t("session.websearch.disable")}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={services.enable}
            disabled={view.busy || view.unavailable || !view.current}
          >
            {language.t("session.websearch.enable")}
          </Button>
        </div>
      </div>
    </section>
  )
}
