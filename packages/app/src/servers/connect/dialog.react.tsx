/** @jsxImportSource react */
import { lazy, Suspense, useId, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { Icon } from "@/runtime/react/icon.react"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"
import type { ServerFormController } from "./dialog"
import type { ConnectMethod } from "./method"
import { ConnectMethodSwitch } from "./method.react"

const PairingScannerView = lazy(async () => {
  const { PairingScannerView } = await import("./scanner.react")
  return { default: PairingScannerView }
})

export function ServerDialog(props: {
  source: SharedSource<{
    language: SharedLanguage
    open: boolean
    mode: "add" | "edit"
    method: ConnectMethod
    busy: boolean
    signedOut: boolean
    scanning: boolean
    link: string
    value: string
    name: string
    password: string
    error: string
    web: boolean
    cameraAvailable: boolean
    cameraLoading: boolean
    cameraHint: string
  }>
  change: ServerFormController["change"]
  scan: ServerFormController["scan"]
  submit: () => void
  close: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  const id = useId()
  const title = language.t(view.mode === "add" ? "dialog.server.add.title" : "dialog.server.edit.title")
  return (
    <Dialog
      open={view.open}
      title={title}
      showClose={false}
      header={() => <span className="text-heading">{title}</span>}
      className="settings-server-dialog max-h-[calc(100dvh-32px)]"
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
      actions={
        view.scanning
          ? undefined
          : () => (
              <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-4">
                <Button variant="secondary" disabled={view.busy} onClick={props.close}>
                  {language.t("common.cancel")}
                </Button>
                <Button type="submit" form={id} variant="primary" disabled={view.busy}>
                  {language.t(
                    view.busy
                      ? "dialog.server.add.checking"
                      : view.mode === "add"
                        ? "dialog.server.add.button"
                        : "common.save",
                  )}
                </Button>
              </div>
            )
      }
    >
      {view.scanning ? (
        <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
          <PairingScannerView
            language={language}
            redeem={props.scan.redeem}
            onScan={props.scan.complete}
            onCancel={props.scan.stop}
          />
        </Suspense>
      ) : (
        <form
          id={id}
          className="flex w-full min-w-0 flex-col gap-6 pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            props.submit()
          }}
        >
          {view.signedOut && (
            <p className="settings-server-dialog-notice" role="status">
              <Icon name="lock" size="small" />
              <span>{language.t("dialog.server.signedOut")}</span>
            </p>
          )}
          <div className="flex w-full min-w-0 flex-col gap-2">
            <label htmlFor={`${id}-address`} className="settings-server-dialog-label">
              {language.t(view.method === "link" ? "server.connect.link" : "dialog.server.add.url")}
            </label>
            <Input
              key={view.method}
              id={`${id}-address`}
              type="text"
              controlSize="lg"
              className="w-full self-stretch"
              dir={view.method === "link" ? "ltr" : undefined}
              spellCheck={view.method === "link" ? false : undefined}
              autoCapitalize={view.method === "link" ? "off" : undefined}
              value={view.method === "link" ? view.link : view.value}
              placeholder={language.t(
                view.method === "link" ? "server.connect.link.placeholder" : "dialog.server.add.placeholder",
              )}
              aria-invalid={!!view.error}
              aria-describedby={view.error ? `${id}-error` : undefined}
              disabled={view.busy}
              autoFocus
              onValueChange={view.method === "link" ? props.change.link : props.change.value}
            />
            {view.error && (
              <span id={`${id}-error`} className="settings-server-dialog-error" role="alert">
                {view.error}
              </span>
            )}
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <label htmlFor={`${id}-name`} className="settings-server-dialog-label">
              {language.t("dialog.server.add.name")}
            </label>
            <Input
              id={`${id}-name`}
              type="text"
              controlSize="lg"
              className="w-full self-stretch"
              value={view.name}
              placeholder={language.t("dialog.server.add.namePlaceholder")}
              disabled={view.busy}
              onValueChange={props.change.name}
            />
          </div>
          {view.method === "password" && (
            <div className="flex w-full min-w-0 flex-col gap-2">
              <label htmlFor={`${id}-password`} className="settings-server-dialog-label">
                {language.t("dialog.server.add.password")}
              </label>
              <Input
                id={`${id}-password`}
                type="password"
                controlSize="lg"
                className="w-full self-stretch"
                value={view.password}
                placeholder={language.t("dialog.server.add.passwordPlaceholder")}
                disabled={view.busy}
                aria-describedby={`${id}-password-hint`}
                onValueChange={props.change.password}
              />
              <span id={`${id}-password-hint`} className="settings-server-dialog-hint">
                {language.t("server.connect.password.hint")}
              </span>
            </div>
          )}
          {view.method === "link" &&
            view.web &&
            (view.cameraAvailable || view.cameraLoading ? (
              <Button
                variant="secondary"
                size="lg"
                className="w-full self-stretch"
                disabled={view.busy || !view.cameraAvailable}
                onClick={props.scan.start}
              >
                {language.t("server.connect.scan")}
              </Button>
            ) : (
              <span className="settings-server-dialog-hint">{view.cameraHint}</span>
            ))}
          <ConnectMethodSwitch
            language={language}
            method={view.method}
            disabled={view.busy}
            onChange={props.change.method}
          />
        </form>
      )}
    </Dialog>
  )
}
