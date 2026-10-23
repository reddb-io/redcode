/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "@/runtime/react/icon.react"
import type { createSessionPermissionServices } from "./session-permission-dock"

export function SessionPermissionDockView(props: { services: ReturnType<typeof createSessionPermissionServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  return (
    <div data-component="dock-prompt" data-kind="permission">
      <div data-dock-surface="shell" data-slot="permission-body">
        <div data-slot="permission-header">
          <div data-slot="permission-row" data-variant="header">
            <span data-slot="permission-icon">
              <Icon name="warning" className="text-feedback-warning-foreground" />
            </span>
            <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
          </div>
        </div>
        <div data-slot="permission-content">
          {view.description && (
            <div data-slot="permission-row">
              <span data-slot="permission-spacer" aria-hidden="true" />
              <div data-slot="permission-hint">{view.description}</div>
            </div>
          )}
          {!!view.resources.length && (
            <div data-slot="permission-row">
              <span data-slot="permission-spacer" aria-hidden="true" />
              <div data-slot="permission-patterns">
                {view.resources.map((pattern, index) => (
                  <code key={index} className="break-all">
                    {pattern}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div data-dock-surface="tray" data-dock-attach="none" data-slot="permission-footer">
        <div />
        <div data-slot="permission-footer-actions">
          <Button variant="ghost" size="md" onClick={() => services.decide("reject")} disabled={view.responding}>
            {language.t("ui.permission.deny")}
          </Button>
          <Button variant="secondary" size="md" onClick={() => services.decide("always")} disabled={view.responding}>
            {language.t("ui.permission.allowAlways")}
          </Button>
          <Button variant="primary" size="md" onClick={() => services.decide("once")} disabled={view.responding}>
            {language.t("ui.permission.allowOnce")}
          </Button>
        </div>
      </div>
    </div>
  )
}
