/** @jsxImportSource react */
import { useCallback, useSyncExternalStore } from "react"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { listRow } from "@reddb-io/design-system/app/recipes"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { Icon } from "@/runtime/react/icon.react"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"
import { ProviderModelIcon } from "@/settings/providers/provider-icon.react"
import type { createIntegrationConnectionsServices } from "./manage"

export function ManageIntegrationDialog(props: {
  source: SharedSource<{ language: SharedLanguage; open: boolean; title: string }>
  services: ReturnType<typeof createIntegrationConnectionsServices>
  close: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return (
    <Dialog
      open={view.open}
      title={view.title}
      description={view.language.t("provider.manage.description")}
      showClose={false}
      header={() => <DialogHeader title={view.title} language={view.language} close={props.close} />}
      className="max-h-[calc(100dvh-32px)]"
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
    >
      <IntegrationConnectionsView services={props.services} />
    </Dialog>
  )
}

export function IntegrationConnectionsView(props: {
  services: ReturnType<typeof createIntegrationConnectionsServices>
}) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const state = view.state
  const row = listRow()
  const focusRename = useCallback((input: HTMLInputElement | null) => {
    input?.focus()
    input?.select()
  }, [])
  return (
    <div
      data-component="integration-connections"
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3"
    >
      {view.heading && (
        <div className="flex items-center gap-2">
          <ProviderModelIcon provider={{ id: view.integrationID }} className="shrink-0 text-foreground" />
          <span className="text-[15px] font-medium leading-5 tracking-[-0.13px] text-foreground">{view.name}</span>
        </div>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-eyebrow uppercase text-ink-muted">{language.t("provider.manage.saved")}</h3>
        <div className="divide-y divide-elevation-base-border">
          {!view.connections.length && (
            <p className="text-body text-ink-muted">{language.t("provider.manage.empty")}</p>
          )}
          {view.connections.map((connection, index) => (
            <div
              key={connection.id}
              data-credential-id={connection.id}
              className={row.root({ class: "flex-wrap gap-2" })}
            >
              <div className={row.text()}>
                {state.renaming === connection.id ? (
                  <form
                    className="flex min-w-0 items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      services.rename(connection.id)
                    }}
                  >
                    <Input
                      type="text"
                      ref={focusRename}
                      className="w-full"
                      aria-label={language.t("provider.manage.rename.label")}
                      value={state.label}
                      onValueChange={(label) => services.update({ label })}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return
                        event.preventDefault()
                        event.stopPropagation()
                        services.update({ renaming: undefined })
                      }}
                    />
                    <Button type="submit" variant="primary" disabled={!state.label.trim() || !!state.busy}>
                      {language.t("common.save")}
                    </Button>
                  </form>
                ) : (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate">{connection.label}</span>
                    {index === 0 && (
                      <>
                        <Badge>{language.t("settings.providers.account.active")}</Badge>
                        {view.keyRole && <Badge>{view.keyRole}</Badge>}
                      </>
                    )}
                  </span>
                )}
              </div>
              {state.renaming !== connection.id && (
                <div className="flex items-center gap-1">
                  {index !== 0 && (
                    <Button
                      variant="ghost"
                      disabled={!!state.busy}
                      aria-busy={state.busy === connection.id}
                      onClick={() => services.activate(connection.id, connection.label)}
                    >
                      {language.t("provider.manage.activate")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={language.t("provider.manage.rename", { account: connection.label })}
                    title={language.t("provider.manage.rename", { account: connection.label })}
                    disabled={!!state.busy}
                    onClick={() =>
                      services.update({ renaming: connection.id, label: connection.label, deleting: undefined })
                    }
                  >
                    <Icon name="pencil-line" size="small" />
                  </Button>
                  {state.deleting === connection.id ? (
                    <Button variant="secondary" disabled={!!state.busy} onClick={() => services.remove(connection.id)}>
                      {language.t("provider.manage.delete.confirm")}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={language.t("provider.manage.delete", { account: connection.label })}
                      title={language.t("provider.manage.delete", { account: connection.label })}
                      disabled={!!state.busy}
                      onClick={() => services.remove(connection.id)}
                    >
                      <Icon name="trash" size="small" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        {view.canAdd && (
          <Button variant="secondary" disabled={!!state.busy} onClick={services.add}>
            <Icon name="plus" />
            {language.t("provider.manage.add")}
          </Button>
        )}
        {view.canCheck && (
          <Button variant="secondary" disabled={state.checking} aria-busy={state.checking} onClick={services.check}>
            {language.t(state.checking ? "provider.manage.check.running" : "provider.manage.check")}
          </Button>
        )}
        {view.canPick && (
          <Button variant="primary" onClick={services.pickModel}>
            {language.t("provider.manage.pickModel")}
          </Button>
        )}
      </div>
      {state.report && (
        <div
          role="status"
          data-component="connection-check-report"
          data-ok={state.report.ok ? "" : undefined}
          className="flex flex-col gap-2 rounded-md border border-muted p-3 text-body"
        >
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Icon
              name={state.report.ok ? "circle-check" : "circle-ban-sign"}
              size="small"
              className={state.report.ok ? "text-feedback-success-foreground" : "text-feedback-danger-foreground"}
            />
            {language.t(state.report.ok ? "provider.manage.check.passed" : "provider.manage.check.failed")}
          </div>
          <p className="m-0 text-ink-muted">{state.report.message}</p>
          {ConnectionCheck.describe(state.report.requests) && (
            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-4 text-ink-muted">
              {ConnectionCheck.describe(state.report.requests)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
