import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { ShareServerDialog } from "./share-dialog.react"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { renderSVG } from "uqr"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { forwardedPairingAddress, pairingAddresses } from "./share"
import { DialogHttpsAccess } from "./https-dialog"
import "./share.css"

export function DialogShareServer(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const context = useServerCtx(() => props.server)
  const [info, { refetch }] = createResource(() => context().sdk.api.server.info())
  const addresses = createMemo(() =>
    pairingAddresses([...(info.error ? [] : (info.latest?.urls ?? [])), props.server.http.url]),
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
        () => setState("error", language.t("server.access.generateFailed")),
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

  const modal = useNativeDialog()
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    server: serverName(props.server),
    open: modal.open(),
    state: { ...state },
    addresses: addresses(),
    address: address(),
    loading: info.loading,
    failed: !!info.error,
    active: active(),
    link: link(),
    qr: qr(),
    expiry: expiry(),
  }))
  return (
    <ReactView
      component={ShareServerDialog}
      props={{
        source,
        close: modal.close,
        update: (patch: Partial<typeof state>) => setState(patch),
        configureHttps: () => void dialog.push(() => <DialogHttpsAccess server={props.server} />),
        retry: () => void refetch(),
        generate: () => void generate(),
        cancel: () => void cancel(),
        copy: () => void copy(),
      }}
    />
  )
}
