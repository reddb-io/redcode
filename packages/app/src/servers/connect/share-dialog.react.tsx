/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"

type ShareState = {
  address: string
  custom: string
  external: boolean
  code: string
  expires: number
  now: number
  busy: boolean
  copied: boolean
  error: string
}

export function ShareServerDialog(props: {
  source: SharedSource<{
    language: SharedLanguage
    open: boolean
    state: ShareState
    addresses: string[]
    address: string | undefined
    loading: boolean
    failed: boolean
    active: boolean
    link: string
    qr: string
    expiry: string
  }>
  close: () => void
  update: (patch: Partial<ShareState>) => void
  configureHttps: () => void
  retry: () => void
  generate: () => void
  cancel: () => void
  copy: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const state = view.state
  const language = view.language
  return (
    <Dialog
      open={view.open}
      title={language.t("server.share.title")}
      description={language.t("server.share.description")}
      showClose={false}
      header={() => <DialogHeader title={language.t("server.share.title")} language={language} close={props.close} />}
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
      className="max-h-[calc(100dvh-32px)]"
      actions={() => (
        <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={props.close}>
            {language.t("common.close")}
          </Button>
          <Button
            variant="primary"
            disabled={state.busy || view.loading || view.failed || !view.address}
            onClick={props.generate}
          >
            {language.t(
              state.busy ? "server.share.working" : state.code ? "server.share.regenerate" : "server.share.generate",
            )}
          </Button>
        </div>
      )}
    >
      <div className="server-share">
        <p>{language.t("server.share.access")}</p>
        <Button variant="secondary" onClick={props.configureHttps}>
          {language.t("https.configure")}
        </Button>
        {view.loading && <p role="status">{language.t("server.share.loading")}</p>}
        {view.failed && (
          <>
            <p role="alert" className="server-share-error">
              {language.t("server.share.infoFailed")}
            </p>
            <Button variant="secondary" onClick={props.retry}>
              {language.t("server.share.retry")}
            </Button>
          </>
        )}
        {!view.loading && !view.failed && (
          <>
            {view.addresses.length > 0 && (
              <div className="server-share-field">
                <label htmlFor="server-share-address">{language.t("server.share.address")}</label>
                <Select
                  id="server-share-address"
                  options={view.addresses.map((value) => ({ value, label: value }))}
                  value={state.address}
                  disabled={state.external || state.busy}
                  onValueChange={(address) => props.update({ address, copied: false })}
                />
              </div>
            )}
            {!view.addresses.length && !state.external && <p role="status">{language.t("server.share.localOnly")}</p>}
            <Button
              variant="ghost"
              disabled={state.busy}
              onClick={() => props.update({ external: !state.external, copied: false })}
            >
              {language.t(state.external ? "server.share.discovered" : "server.share.external")}
            </Button>
            {state.external && (
              <div className="server-share-field">
                <label htmlFor="server-share-external">{language.t("server.share.externalAddress")}</label>
                <Input
                  id="server-share-external"
                  value={state.custom}
                  disabled={state.busy}
                  spellCheck={false}
                  autoCapitalize="off"
                  dir="ltr"
                  onValueChange={(custom) => props.update({ custom, copied: false })}
                  placeholder={language.t("server.share.externalPlaceholder")}
                />
                <p>{language.t("server.share.externalHint")}</p>
                {state.custom.trim() && !view.address && (
                  <p role="alert" className="server-share-error">
                    {language.t("server.share.invalidAddress")}
                  </p>
                )}
              </div>
            )}
            {!view.addresses.length && !state.external && (
              <div className="server-share-setup">
                <p>{language.t("server.share.networkHint")}</p>
                <code>redcode service set hostname 0.0.0.0</code>
                <code>redcode service start</code>
                <p>{language.t("server.share.remoteHint")}</p>
                <code>redcode pair --remote</code>
                <p>{language.t("server.share.setupEffect")}</p>
              </div>
            )}
            {view.active && view.link && (
              <div className="server-share-result">
                <img src={view.qr} alt={language.t("server.share.qr")} width="192" height="192" />
                <div className="server-share-field">
                  <label htmlFor="server-share-link">{language.t("server.connect.link")}</label>
                  <Input id="server-share-link" readOnly value={view.link} dir="ltr" />
                  <Button variant="secondary" disabled={state.busy} onClick={props.copy}>
                    {language.t(state.copied ? "server.share.copied" : "server.share.copy")}
                  </Button>
                </div>
                <p>{language.t("server.share.expires", { time: view.expiry })}</p>
                <p>{language.t("server.share.instructions")}</p>
              </div>
            )}
            {state.code && !view.active && <p role="status">{language.t("server.share.expired")}</p>}
            {state.code && (
              <>
                <Button variant="ghost" disabled={state.busy} onClick={props.cancel}>
                  {language.t("server.share.cancel")}
                </Button>
                <p>{language.t("server.share.cancelHint")}</p>
              </>
            )}
          </>
        )}
        {state.error && (
          <p role="alert" className="server-share-error">
            {state.error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
