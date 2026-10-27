/** @jsxImportSource react */
import { useState } from "react"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Button } from "@reddb-io/design-system/base/Button"
import { CodeBlock } from "@reddb-io/design-system/base/CodeBlock"
import { DescriptionList } from "@reddb-io/design-system/base/DescriptionList"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import type { DeliveryHooks, HookAction } from "./hooks"

export function DeliveryHooksView(props: {
  view: ReturnType<DeliveryHooks["snapshot"]>
  actions: DeliveryHooks["actions"]
  copy: Record<string, string>
}) {
  const view = props.view
  const copy = props.copy
  const [review, setReview] = useState<{ action: HookAction; fingerprint: string } | null>(null)
  const disabled = !view.connected || view.unavailable || view.loading || view.refreshing || view.pending
  const changed = !!review && review.fingerprint !== view.status?.trust.fingerprint
  const request = (action: HookAction) => {
    if (!view.status) return
    props.actions.clear()
    setReview({ action, fingerprint: view.status.trust.fingerprint })
  }
  const definitions = view.status?.definitions ?? []
  return (
    <div className="flex min-w-0 flex-col gap-[var(--reddb-spatial-layout-gap-md)]">
      <p className="m-0 text-caption text-ink-muted">{copy.hooksNote}</p>
      <DescriptionList items={[{ term: copy.hooksDirectory, detail: view.directory }]} className="[&_dd]:break-all" />
      {(!view.connected || view.unavailable) && (
        <p role="alert" className="m-0 text-caption text-feedback-warning-foreground">
          {view.connected ? copy.hooksUnavailable : copy.hooksDisconnected}
        </p>
      )}
      {view.loading && view.connected && !view.unavailable && <p role="status">{copy.hooksLoading}</p>}
      {view.imported && (
        <p role="status" className="m-0 break-all text-caption">
          {copy.hooksImported} <code>{view.imported.target}</code>
          {view.imported.restart_required && <> {copy.hooksReload}</>}
        </p>
      )}
      {view.status && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={view.status.trust.trusted ? "success" : "warning"}>
              {view.status.trust.trusted ? copy.hooksTrusted : copy.hooksUntrusted}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || (!view.status.trust.trusted && !definitions.length)}
              onClick={() => request(view.status?.trust.trusted ? "revoke" : "trust")}
            >
              {view.status.trust.trusted ? copy.hooksRevoke : copy.hooksTrust}
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => request("import")}>
              {copy.hooksImport}
            </Button>
          </div>
          <ul aria-label={copy.hooksDefinitions} className="m-0 list-none space-y-3 p-0">
            {definitions.map((item) => (
              <li key={item.id} className="min-w-0 rounded-lg border border-elevation-raised-border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="m-0 break-all text-body font-medium">{item.event}</h3>
                  <Badge
                    tone={item.support === "active" ? "success" : item.support === "untrusted" ? "warning" : "neutral"}
                  >
                    {copy[`hooksSupport.${item.support}`]}
                  </Badge>
                </div>
                <DescriptionList
                  className="mb-3 [&_dd]:break-all"
                  items={[
                    { term: copy.hooksSource, detail: item.source },
                    { term: copy.hooksHandler, detail: item.handler.type },
                    ...(item.matcher ? [{ term: copy.hooksMatcher, detail: item.matcher }] : []),
                    ...(item.reason && item.support === "unsupported"
                      ? [{ term: copy.hooksReason, detail: item.reason }]
                      : []),
                    ...(item.handler.timeout === undefined
                      ? []
                      : [{ term: copy.hooksTimeout, detail: String(item.handler.timeout) }]),
                    ...(item.handler.type === "command" && item.handler.async
                      ? [{ term: copy.hooksExecution, detail: copy.hooksAsync }]
                      : []),
                    ...(item.handler.type === "http"
                      ? [
                          { term: copy.hooksURL, detail: item.handler.url },
                          {
                            term: copy.hooksHeaders,
                            detail: Object.keys(item.handler.headers ?? {}).join(", ") || copy.hooksNoHeaders,
                          },
                        ]
                      : []),
                  ]}
                />
                {item.handler.type === "command" && (
                  <CodeBlock
                    code={item.handler.command}
                    regionLabel={copy.hooksCommand}
                    copyLabel={copy.hooksCopy}
                    copiedLabel={copy.hooksCopied}
                    copyErrorLabel={copy.hooksCopyFailed}
                  />
                )}
              </li>
            ))}
          </ul>
          {!definitions.length && <p className="m-0 text-caption text-ink-muted">{copy.hooksEmpty}</p>}
        </>
      )}
      <Dialog
        open={!!review}
        title={review ? copy[`hooksConfirm.${review.action}`] : copy.hooks}
        description={review ? copy[`hooksConfirmNote.${review.action}`] : undefined}
        dismissible={!view.pending}
        showClose={!view.pending}
        onOpenChange={(open) => {
          if (!open && !view.pending) setReview(null)
        }}
        actions={() => (
          <>
            <Button variant="secondary" disabled={view.pending} onClick={() => setReview(null)}>
              {copy.hooksCancel}
            </Button>
            <Button
              disabled={disabled || changed}
              onClick={() => {
                if (!review || disabled || changed) return
                void props.actions.run(review.action).then(
                  () => setReview(null),
                  () => undefined,
                )
              }}
            >
              {view.pending ? copy.hooksApplying : copy.hooksConfirm}
            </Button>
          </>
        )}
      >
        <p className="break-all text-body">{view.directory}</p>
        {review?.action === "trust" && <p className="text-caption">{copy.hooksTrustScope}</p>}
        {changed && <p role="alert">{copy.hooksChanged}</p>}
        {view.failed && <p role="alert">{copy.hooksFailed}</p>}
      </Dialog>
    </div>
  )
}
