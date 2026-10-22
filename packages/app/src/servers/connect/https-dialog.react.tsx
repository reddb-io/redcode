/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import { Switch } from "@reddb-io/design-system/base/Switch"
import type { ServerRemoteAccessOutput } from "@opencode/client/promise"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SharedMount } from "@/runtime/react/mount"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"

export function HttpsAccessDialog(props: {
  source: SharedSource<{
    language: SharedLanguage
    open: boolean
    fixed: boolean
    server: string
    servers: { value: string; label: string }[]
  }>
  content: SharedMount
  close: () => void
  select: (key: string) => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  return (
    <Dialog
      open={view.open}
      title={language.t("https.title")}
      description={language.t("https.description")}
      showClose={false}
      header={() => <DialogHeader title={language.t("https.title")} language={language} close={props.close} />}
      className="max-h-[calc(100dvh-32px)]"
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
      actions={() => (
        <div className="flex shrink-0 justify-end pt-4">
          <Button variant="secondary" onClick={props.close}>
            {language.t("common.close")}
          </Button>
        </div>
      )}
    >
      <div className="server-share">
        {!view.fixed && (
          <div className="server-share-field">
            <label htmlFor="https-host">{language.t("https.host")}</label>
            <Select id="https-host" value={view.server} options={view.servers} onValueChange={props.select} />
          </div>
        )}
        <SharedSlot mount={props.content} />
      </div>
    </Dialog>
  )
}

type HttpsState = {
  provider: string
  relay: string
  accepted: boolean
  busy: boolean
  error: string
  code: string
  expires: number
  now: number
  copied: boolean
  confirmDisable: boolean
  editing: boolean
}

export function HttpsAccessView(props: {
  source: SharedSource<{
    language: SharedLanguage
    host: string
    state: HttpsState
    info: ServerRemoteAccessOutput | undefined
    loading: boolean
    failed: boolean
    working: boolean
    validRelay: boolean
    link: string
    qr: string
  }>
  update: (patch: Partial<HttpsState>) => void
  retry: () => void
  configure: () => void
  disable: () => void
  generate: () => void
  copy: () => void
  openLink: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const state = view.state
  const language = view.language
  return (
    <>
      <p>{language.t("https.selectedHost", { host: view.host })}</p>
      {view.loading && <p role="status">{language.t("server.share.loading")}</p>}
      {(view.failed || (!view.loading && view.info?.available === false)) && (
        <>
          <p role="alert">{language.t("https.unavailable")}</p>
          <Button variant="secondary" onClick={props.retry}>
            {language.t("server.share.retry")}
          </Button>
        </>
      )}
      {!view.failed && view.info?.available && (
        <>
          <p role="status" aria-live="polite">
            {language.t(`https.state.${view.info.state}`)}
          </p>
          {view.info.state === "failed" && <p role="alert">{language.t("https.failed")}</p>}
          {view.info.url && <Input readOnly value={view.info.url} aria-label={language.t("https.address")} dir="ltr" />}
          {(view.info.state !== "ready" || state.editing) && (
            <>
              <div className="server-share-field">
                <label htmlFor="https-provider">{language.t("https.provider")}</label>
                <Select
                  id="https-provider"
                  value={state.provider}
                  options={[
                    { value: "", label: "", disabled: true },
                    { value: "own", label: language.t("https.provider.own") },
                    { value: "hosted", label: language.t("https.provider.hosted") },
                  ]}
                  disabled={state.busy || view.working}
                  onValueChange={(provider) => props.update({ provider, accepted: false })}
                />
              </div>
              {state.provider === "own" && (
                <div className="server-share-field">
                  <label htmlFor="https-relay">{language.t("https.relay")}</label>
                  <Input
                    id="https-relay"
                    value={state.relay}
                    disabled={state.busy || view.working}
                    dir="ltr"
                    spellCheck={false}
                    placeholder={language.t("https.relayPlaceholder")}
                    onValueChange={(relay) => props.update({ relay, accepted: false })}
                  />
                  <p>{language.t("https.relayHint")}</p>
                </div>
              )}
              {state.provider === "hosted" && <p>{language.t("https.hostedHint")}</p>}
              <p>{language.t("https.exposure")}</p>
              <div className="server-share-consent">
                <Switch
                  label={language.t("https.consent")}
                  checked={state.accepted}
                  disabled={state.busy || view.working}
                  onCheckedChange={(accepted) => props.update({ accepted })}
                />
              </div>
              <Button
                variant="primary"
                disabled={!state.provider || !state.accepted || !view.validRelay || state.busy || view.working}
                onClick={props.configure}
              >
                {language.t(view.working ? "https.working" : "https.enable")}
              </Button>
            </>
          )}
          <Button variant="ghost" disabled={state.busy || view.loading} onClick={props.retry}>
            {language.t("https.refresh")}
          </Button>
          {view.info.state === "ready" && !view.link && (
            <>
              <p>{language.t("https.readyHint")}</p>
              <Button variant="secondary" disabled={state.busy} onClick={props.generate}>
                {language.t("https.generate")}
              </Button>
            </>
          )}
          {view.link && (
            <div className="server-share-result">
              <Input readOnly value={view.link} aria-label={language.t("server.connect.link")} dir="ltr" />
              <Button variant="secondary" onClick={props.copy}>
                {language.t(state.copied ? "server.share.copied" : "server.share.copy")}
              </Button>
              <Button variant="primary" onClick={props.openLink}>
                {language.t("https.open")}
              </Button>
              <img src={view.qr} alt={language.t("server.share.qr")} width="192" height="192" />
              <p>{language.t("https.installHint")}</p>
              <p>
                {language.t("server.share.expires", {
                  time: `${Math.floor((state.expires - state.now) / 60000)}:${String(Math.floor((state.expires - state.now) / 1000) % 60).padStart(2, "0")}`,
                })}
              </p>
            </div>
          )}
          {state.code && !view.link && <p role="status">{language.t("server.share.expired")}</p>}
          {view.info.state === "ready" && !state.editing && (
            <Button variant="ghost" disabled={state.busy} onClick={() => props.update({ editing: true })}>
              {language.t("https.change")}
            </Button>
          )}
          {(view.info.url || view.info.state === "failed") && (
            <>
              <Button
                variant="ghost"
                disabled={state.busy || view.working}
                onClick={() => props.update({ confirmDisable: !state.confirmDisable })}
              >
                {language.t("https.disable")}
              </Button>
              {state.confirmDisable && (
                <>
                  <p>{language.t("https.disableHint")}</p>
                  <Button variant="secondary" disabled={state.busy || view.working} onClick={props.disable}>
                    {language.t("https.confirmDisable")}
                  </Button>
                </>
              )}
            </>
          )}
        </>
      )}
      {state.error && (
        <p role="alert" className="server-share-error">
          {state.error}
        </p>
      )}
    </>
  )
}
