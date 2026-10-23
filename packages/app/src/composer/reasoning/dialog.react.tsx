/** @jsxImportSource react */
import { Fragment, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import { ReasoningChoices } from "./choices.react"
import type { createIntelligenceDialogServices, createReasoningModeServices } from "./dialog"

export function ReasoningModeDialog(props: { services: ReturnType<typeof createReasoningModeServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const title = view.language.t("command.reasoning.mode")
  return (
    <Dialog
      open={view.open}
      title={title}
      showClose={false}
      className="h-fit"
      header={() => <DialogHeader title={title} language={view.language} close={services.close} />}
      onOpenChange={(open) => {
        if (!open) services.close()
      }}
    >
      <ReasoningChoices label={title} items={view.choices} value={view.choice} select={services.select} />
    </Dialog>
  )
}

export function IntelligenceDialog(props: { services: ReturnType<typeof createIntelligenceDialogServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const title = language.t("composer.reasoning.dialog.title")
  return (
    <Dialog
      open={view.open}
      title={title}
      size="lg"
      showClose={false}
      className="h-fit max-h-[calc(100dvh-32px)] [&_[data-dialog-body]]:overflow-hidden"
      header={() => <DialogHeader title={title} language={language} close={services.close} />}
      onOpenChange={(open) => {
        if (!open) services.close()
      }}
    >
      <ScrollArea variant="plain" label={title} className="min-h-0 max-h-[calc(100dvh-160px)]">
        <div className="flex min-w-0 flex-col gap-5">
          {view.rows ? (
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-body">
              {view.rows.map((row) => (
                <Fragment key={row.name}>
                  <dt className="text-ink-muted">{row.name}</dt>
                  <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <p role="status" className="text-body text-ink-muted">
              {view.status}
            </p>
          )}
          <div>
            <Button onClick={services.setup}>{language.t("composer.reasoning.dialog.configure")}</Button>
          </div>
          <section className="flex flex-col gap-2" aria-label={language.t("composer.reasoning.dialog.evaluations")}>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              {language.t("composer.reasoning.dialog.evaluations")}
            </h3>
            {!view.evaluations ? (
              <p role="status" className="text-body text-ink-muted">
                {view.history}
              </p>
            ) : !view.evaluations.length ? (
              <p className="text-body text-ink-muted">{language.t("composer.reasoning.dialog.empty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-elevation-base-border">
                {view.evaluations.map((evaluation, index) => (
                  <li key={index} className="flex flex-col gap-0.5 py-2">
                    <div className="flex min-w-0 items-baseline gap-3">
                      <span className="min-w-0 truncate font-mono text-[12px] text-foreground">
                        {evaluation.operation}
                      </span>
                      <span className="ms-auto shrink-0 text-caption tabular-nums text-ink-muted">
                        {evaluation.created}
                      </span>
                    </div>
                    <div className="min-w-0 break-words text-caption text-ink-muted">{evaluation.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </Dialog>
  )
}
