import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createResource, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { renderSVG } from "uqr"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import "./share.css"

export function DialogHttpsAccess(props: { server?: ServerConnection.Any }) {
  const language = useLanguage()
  const dialog = useDialog()
  const servers = useServers()
  const initial =
    props.server ??
    servers.list.find((server) => new URL(server.http.url).origin === location.origin) ??
    (servers.list.length === 1 ? servers.list[0] : undefined)
  const [state, setState] = createStore({ key: initial ? String(ServerConnection.key(initial)) : "" })
  const server = createMemo(() => props.server ?? servers.list.find((item) => ServerConnection.key(item) === state.key))
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title={language.t("https.title")} description={language.t("https.description")} />
      </DialogHeader>
      <DialogBody class="server-share">
        <Show when={!props.server}>
          <div class="server-share-field">
            <span id="https-host-label">{language.t("https.host")}</span>
            <Select
              options={servers.list}
              current={server()}
              value={(item) => ServerConnection.key(item)}
              label={(item) => serverName(item) || item.http.url}
              aria-labelledby="https-host-label"
              onSelect={(item) => item && setState("key", ServerConnection.key(item))}
            />
          </div>
        </Show>
        <Show when={server()} keyed>
          {(selected) => <HttpsAccess server={selected} />}
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function HttpsAccess(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const platform = usePlatform()
  const context = useServerCtx(() => props.server)
  const [info, { refetch, mutate }] = createResource(() => context().sdk.api.server.remoteAccess())
  const [state, setState] = createStore({
    provider: "",
    relay: "",
    accepted: false,
    busy: false,
    error: "",
    code: "",
    expires: 0,
    now: Date.now(),
    copied: false,
    confirmDisable: false,
    editing: false,
  })
  const providers = [
    { value: "own", label: language.t("https.provider.own") },
    { value: "hosted", label: language.t("https.provider.hosted") },
  ]
  const relay = () => (state.provider === "hosted" ? "https://opentunnel.xyz" : state.relay.trim())
  const validRelay = () => {
    const value = URL.parse(relay())
    return (
      !!value &&
      value.protocol === "https:" &&
      !value.username &&
      !value.password &&
      value.pathname === "/" &&
      !value.search &&
      !value.hash
    )
  }
  const working = createMemo(() => info()?.state === "provisioning" || info()?.state === "connecting")
  const link = createMemo(() =>
    info()?.url && state.code && state.expires > state.now
      ? new URL(`/auth/connect/${state.code}`, info()!.url).href
      : "",
  )
  const qr = createMemo(() =>
    link() ? `data:image/svg+xml,${encodeURIComponent(renderSVG(link(), { border: 4 }))}` : "",
  )
  createEffect(() => {
    if (!working()) return
    let count = 0
    const timer = setInterval(() => {
      if (++count > 240) return clearInterval(timer)
      if (document.visibilityState === "visible") void refetch()
    }, 1500)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(() => {
    if (!state.code) return
    const timer = setInterval(() => setState("now", Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const configure = async () => {
    if (!state.accepted || !state.provider || !validRelay() || state.busy || working()) return
    setState({ busy: true, error: "" })
    await context()
      .sdk.api.server.configureRemoteAccess({ relay: relay(), acceptExposure: true })
      .then(
        (status) => {
          mutate(status)
          setState({ code: "", accepted: false, editing: false })
        },
        () => setState("error", language.t("https.failed")),
      )
    setState("busy", false)
  }
  const disable = async () => {
    if (state.busy || working() || !state.confirmDisable) return
    setState({ busy: true, error: "" })
    await context()
      .sdk.api.server.disableRemoteAccess()
      .then(
        (status) => {
          mutate(status)
          setState({ code: "", confirmDisable: false })
        },
        () => setState("error", language.t("https.failed")),
      )
    setState("busy", false)
  }
  const generate = async () => {
    if (state.busy || info()?.state !== "ready") return
    setState({ busy: true, error: "" })
    await (state.code ? context().sdk.api.server.cancelPair({ code: state.code }) : Promise.resolve())
      .then(() => {
        setState("code", "")
        return context().sdk.api.server.pair()
      })
      .then(
        (pair) =>
          setState({ code: pair.code, expires: Date.now() + pair.expires_in * 1000, now: Date.now(), copied: false }),
        () => setState("error", language.t("server.share.generateFailed")),
      )
    setState("busy", false)
  }
  const copy = async () => {
    if (!link()) return
    await Promise.resolve()
      .then(() => platform.writeClipboardText?.(link()) ?? navigator.clipboard.writeText(link()))
      .then(
        () => setState("copied", true),
        () => setState("error", language.t("server.share.copyFailed")),
      )
  }
  return (
    <>
      <p>{language.t("https.selectedHost", { host: serverName(props.server) || props.server.http.url })}</p>
      <Show when={info.loading}>
        <p role="status">{language.t("server.share.loading")}</p>
      </Show>
      <Show when={info.error || (!info.loading && info()?.available === false)}>
        <p role="alert">{language.t("https.unavailable")}</p>
        <Button variant="neutral" onClick={() => void refetch()}>
          {language.t("server.share.retry")}
        </Button>
      </Show>
      <Show when={!info.error && info()?.available}>
        <p role="status" aria-live="polite">
          {language.t(`https.state.${info()!.state}`)}
        </p>
        <Show when={info()?.state === "failed"}>
          <p role="alert">{language.t("https.failed")}</p>
        </Show>
        <Show when={info()?.url}>
          <TextInput readOnly value={info()!.url} aria-label={language.t("https.address")} dir="ltr" />
        </Show>
        <Show when={info()?.state !== "ready" || state.editing}>
          <div class="server-share-field">
            <span id="https-provider-label">{language.t("https.provider")}</span>
            <Select
              options={providers}
              current={providers.find((provider) => provider.value === state.provider)}
              value={(item) => item.value}
              label={(item) => item.label}
              aria-labelledby="https-provider-label"
              disabled={state.busy || working()}
              onSelect={(item) => item && setState({ provider: item.value, accepted: false })}
            />
          </div>
          <Show when={state.provider === "own"}>
            <div class="server-share-field">
              <label for="https-relay">{language.t("https.relay")}</label>
              <TextInput
                id="https-relay"
                value={state.relay}
                disabled={state.busy || working()}
                dir="ltr"
                spellcheck={false}
                placeholder={language.t("https.relayPlaceholder")}
                onInput={(event) => setState({ relay: event.currentTarget.value, accepted: false })}
              />
              <p>{language.t("https.relayHint")}</p>
            </div>
          </Show>
          <Show when={state.provider === "hosted"}>
            <p>{language.t("https.hostedHint")}</p>
          </Show>
          <p>{language.t("https.exposure")}</p>
          <div class="server-share-consent">
            <Switch
              checked={state.accepted}
              disabled={state.busy || working()}
              onChange={(value) => setState("accepted", value)}
            >
              {language.t("https.consent")}
            </Switch>
          </div>
          <Button
            variant="submit"
            disabled={!state.provider || !state.accepted || !validRelay() || state.busy || working()}
            onClick={() => void configure()}
          >
            {language.t(working() ? "https.working" : "https.enable")}
          </Button>
        </Show>
        <Button variant="ghost" disabled={state.busy || info.loading} onClick={() => void refetch()}>
          {language.t("https.refresh")}
        </Button>
        <Show when={info()?.state === "ready" && !link()}>
          <p>{language.t("https.readyHint")}</p>
          <Button variant="neutral" disabled={state.busy} onClick={() => void generate()}>
            {language.t("https.generate")}
          </Button>
        </Show>
        <Show when={link()}>
          <div class="server-share-result">
            <TextInput readOnly value={link()} aria-label={language.t("server.connect.link")} dir="ltr" />
            <Button variant="neutral" onClick={() => void copy()}>
              {language.t(state.copied ? "server.share.copied" : "server.share.copy")}
            </Button>
            <Button variant="submit" onClick={() => platform.openExternal(link())}>
              {language.t("https.open")}
            </Button>
            <img src={qr()} alt={language.t("server.share.qr")} width="192" height="192" />
            <p>{language.t("https.installHint")}</p>
            <p>
              {language.t("server.share.expires", {
                time: `${Math.floor((state.expires - state.now) / 60000)}:${String(Math.floor((state.expires - state.now) / 1000) % 60).padStart(2, "0")}`,
              })}
            </p>
          </div>
        </Show>
        <Show when={state.code && !link()}>
          <p role="status">{language.t("server.share.expired")}</p>
        </Show>
        <Show when={info()?.state === "ready" && !state.editing}>
          <Button variant="ghost" disabled={state.busy} onClick={() => setState("editing", true)}>
            {language.t("https.change")}
          </Button>
        </Show>
        <Show when={info()?.url || info()?.state === "failed"}>
          <Button
            variant="ghost"
            disabled={state.busy || working()}
            onClick={() => setState("confirmDisable", !state.confirmDisable)}
          >
            {language.t("https.disable")}
          </Button>
          <Show when={state.confirmDisable}>
            <p>{language.t("https.disableHint")}</p>
            <Button variant="neutral" disabled={state.busy || working()} onClick={() => void disable()}>
              {language.t("https.confirmDisable")}
            </Button>
          </Show>
        </Show>
      </Show>
      <Show when={state.error}>
        <p role="alert" class="server-share-error">
          {state.error}
        </p>
      </Show>
    </>
  )
}
