import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedMount } from "@/runtime/react/mount"
import { ReactView } from "@/runtime/react/view"
import { HttpsAccessDialog, HttpsAccessView } from "./https-dialog.react"
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
  const modal = useNativeDialog()
  const servers = useServers()
  const initial =
    props.server ??
    servers.list.find((server) => new URL(server.http.url).origin === location.origin) ??
    (servers.list.length === 1 ? servers.list[0] : undefined)
  const [state, setState] = createStore({ key: initial ? String(ServerConnection.key(initial)) : "" })
  const server = createMemo(() => props.server ?? servers.list.find((item) => ServerConnection.key(item) === state.key))
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    fixed: !!props.server,
    server: server() ? String(ServerConnection.key(server()!)) : "",
    servers: servers.list.map((item) => ({
      value: String(ServerConnection.key(item)),
      label: serverName(item) || item.http.url,
    })),
  }))
  const content = sharedMount(() => (
    <Show when={server()} keyed>
      {(selected) => <HttpsAccess server={selected} />}
    </Show>
  ))
  return (
    <ReactView
      component={HttpsAccessDialog}
      props={{ source, content, close: modal.close, select: (key: string) => setState("key", key) }}
    />
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
  const working = createMemo(() => info.latest?.state === "provisioning" || info.latest?.state === "connecting")
  const link = createMemo(() =>
    info.latest?.url && state.code && state.expires > state.now
      ? new URL(`/auth/connect/${state.code}`, info.latest!.url).href
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
    if (state.busy || info.latest?.state !== "ready") return
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
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    host: serverName(props.server) || props.server.http.url,
    state: { ...state },
    info: info.latest,
    loading: info.loading,
    failed: !!info.error,
    working: working(),
    validRelay: validRelay(),
    link: link() ?? "",
    qr: qr(),
  }))
  return (
    <ReactView
      component={HttpsAccessView}
      props={{
        source,
        update: (patch: Partial<typeof state>) => setState(patch),
        retry: () => void refetch(),
        configure: () => void configure(),
        disable: () => void disable(),
        generate: () => void generate(),
        copy: () => void copy(),
        openLink: () => platform.openExternal(link()),
      }}
    />
  )
}
