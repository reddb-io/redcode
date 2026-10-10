import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { Select } from "@opencode/ui/select"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createResource, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { renderSVG } from "uqr"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { forwardedPairingAddress, pairingAddresses } from "./share"
import "./share.css"

export function DialogShareServer(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const context = useServerCtx(() => props.server)
  const [info, { refetch }] = createResource(() => context().sdk.api.server.info())
  const addresses = createMemo(() =>
    pairingAddresses([...(info.error ? [] : (info()?.urls ?? [])), props.server.http.url]),
  )
  const [state, setState] = createStore({
    address: "",
    custom: "",
    external: false,
    code: "",
    expires: 0,
    now: Date.now(),
    busy: false,
    copied: false,
    error: "",
  })

  createEffect(() => {
    if (!state.address && addresses()[0]) setState("address", addresses()[0])
  })
  const timer = setInterval(() => setState("now", Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))

  const address = createMemo(() =>
    state.external ? forwardedPairingAddress(state.custom) : state.address || undefined,
  )
  const remaining = createMemo(() => Math.max(0, Math.ceil((state.expires - state.now) / 1_000)))
  const active = createMemo(() => !!state.code && remaining() > 0)
  const link = () => (address() && active() ? new URL(`/auth/connect/${state.code}`, address()).href : "")
  const qr = createMemo(() =>
    link() ? `data:image/svg+xml,${encodeURIComponent(renderSVG(link(), { border: 4 }))}` : "",
  )
  const expiry = () => `${Math.floor(remaining() / 60)}:${String(remaining() % 60).padStart(2, "0")}`

  const cancel = async () => {
    if (state.busy || !state.code) return
    setState({ busy: true, error: "" })
    await context()
      .sdk.api.server.cancelPair({ code: state.code })
      .then(
        () => setState({ code: "", expires: 0, copied: false }),
        () => setState("error", language.t("server.share.cancelFailed")),
      )
    setState("busy", false)
  }

  const generate = async () => {
    if (state.busy || !address()) return
    setState({ busy: true, error: "", copied: false })
    // Replace an unused link rather than leaving several grants valid when the user regenerates.
    await (state.code ? context().sdk.api.server.cancelPair({ code: state.code }) : Promise.resolve())
      .then(() => {
        setState({ code: "", expires: 0 })
        return context().sdk.api.server.pair()
      })
      .then(
        (pairing) =>
          setState({ code: pairing.code, expires: Date.now() + pairing.expires_in * 1_000, now: Date.now() }),
        () => setState("error", language.t("server.share.generateFailed")),
      )
    setState("busy", false)
  }

  const copy = async () => {
    if (!link()) return
    await Promise.resolve()
      .then(() => platform.writeClipboardText?.(link()) ?? navigator.clipboard.writeText(link()))
      .then(
        () => setState({ copied: true, error: "" }),
        () => setState("error", language.t("server.share.copyFailed")),
      )
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("server.share.title")}
          description={language.t("server.share.description")}
        />
      </DialogHeader>
      <DialogBody class="server-share">
        <p>{language.t("server.share.access")}</p>
        <Show when={info.loading}>
          <p role="status">{language.t("server.share.loading")}</p>
        </Show>
        <Show when={info.error}>
          <p role="alert" class="server-share-error">
            {language.t("server.share.infoFailed")}
          </p>
          <Button variant="neutral" onClick={() => void refetch()}>
            {language.t("server.share.retry")}
          </Button>
        </Show>
        <Show when={!info.loading && !info.error}>
          <Show
            when={addresses().length}
            fallback={
              <Show when={!state.external}>
                <p role="status">{language.t("server.share.localOnly")}</p>
              </Show>
            }
          >
            <div class="server-share-field">
              <span id="server-share-address-label">{language.t("server.share.address")}</span>
              <Select
                options={addresses()}
                current={state.address}
                disabled={state.external || state.busy}
                aria-labelledby="server-share-address-label"
                onSelect={(value) => value && setState({ address: value, copied: false })}
              />
            </div>
          </Show>
          <Button
            variant="ghost"
            disabled={state.busy}
            onClick={() => setState({ external: !state.external, copied: false })}
          >
            {language.t(state.external ? "server.share.discovered" : "server.share.external")}
          </Button>
          <Show when={state.external}>
            <div class="server-share-field">
              <label for="server-share-external">{language.t("server.share.externalAddress")}</label>
              <TextInput
                id="server-share-external"
                value={state.custom}
                disabled={state.busy}
                spellcheck={false}
                autocapitalize="off"
                dir="ltr"
                onInput={(event) => setState({ custom: event.currentTarget.value, copied: false })}
                placeholder={language.t("server.share.externalPlaceholder")}
              />
              <p>{language.t("server.share.externalHint")}</p>
              <Show when={state.custom.trim() && !address()}>
                <p role="alert" class="server-share-error">
                  {language.t("server.share.invalidAddress")}
                </p>
              </Show>
            </div>
          </Show>
          <Show when={!addresses().length && !state.external}>
            <div class="server-share-setup">
              <p>{language.t("server.share.networkHint")}</p>
              <code>redcode service set hostname 0.0.0.0</code>
              <code>redcode service start</code>
              <p>{language.t("server.share.remoteHint")}</p>
              <code>redcode pair --remote</code>
              <p>{language.t("server.share.setupEffect")}</p>
            </div>
          </Show>
          <Show when={active() && link()}>
            <div class="server-share-result">
              <img src={qr()} alt={language.t("server.share.qr")} width="192" height="192" />
              <div class="server-share-field">
                <label for="server-share-link">{language.t("server.connect.link")}</label>
                <TextInput id="server-share-link" readOnly value={link()} dir="ltr" />
                <Button variant="neutral" disabled={state.busy} onClick={() => void copy()}>
                  {language.t(state.copied ? "server.share.copied" : "server.share.copy")}
                </Button>
              </div>
              <p>{language.t("server.share.expires", { time: expiry() })}</p>
              <p>{language.t("server.share.instructions")}</p>
            </div>
          </Show>
          <Show when={state.code && !active()}>
            <p role="status">{language.t("server.share.expired")}</p>
          </Show>
          <Show when={state.code}>
            <Button variant="ghost" disabled={state.busy} onClick={() => void cancel()}>
              {language.t("server.share.cancel")}
            </Button>
            <p>{language.t("server.share.cancelHint")}</p>
          </Show>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="server-share-error">
            {state.error}
          </p>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
        <Button
          variant="submit"
          disabled={state.busy || info.loading || !!info.error || !address()}
          onClick={() => void generate()}
        >
          {language.t(
            state.busy ? "server.share.working" : state.code ? "server.share.regenerate" : "server.share.generate",
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
