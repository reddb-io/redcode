import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { ServerDialog } from "./dialog.react"
import { useMutation } from "@tanstack/solid-query"
import { type Component, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createServerHealthPreview,
  replaceServerConnection,
  type ServerFormValues,
} from "@/servers/registry/management"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { normalizeServerUrl, ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { useCheckServerHealth } from "@/runtime/server/health"
import { usePlatform } from "@/runtime/platform/platform"
import { isMixedContent } from "./browser"
import { cameraHint, createCameraAvailability } from "./camera"
import { bareServerAddress, pairingLink, type Pairing } from "./pairing"
import { useRedeemPairing } from "./redeem"
import type { ConnectMethod } from "./method"
import "@/settings/settings.css"

type FormMode = "list" | "add" | "edit"

export const DialogServer: Component<{
  mode: "add" | "edit"
  server?: ServerConnection.Http
  onSave?: (server: ServerConnection.Http) => void
}> = (props) => {
  const modal = useNativeDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const camera = createCameraAvailability()

  const form = createFormController({
    // Close first: onSave may open the next dialog, such as the folder picker an interrupted action continues with.
    onSelect: (server) => {
      modal.close()
      props.onSave?.(server)
    },
  })

  const [opened, setOpened] = createSignal(false)

  onMount(() => {
    if (props.mode === "add") form.start.add()

    if (props.mode === "edit" && props.server) form.start.edit(props.server)
    setOpened(true)
  })

  onCleanup(() => {
    form.reset()
  })

  createEffect(() => {
    if (!opened()) return

    if (form.state.open()) return
    modal.close()
  })

  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    mode: props.mode,
    method: form.state.method(),
    busy: form.state.busy(),
    signedOut: form.state.signedOut(),
    scanning: form.state.scanning(),
    link: form.state.link(),
    value: form.state.value(),
    name: form.state.name(),
    password: form.state.password(),
    error: form.state.error(),
    web: platform.platform === "web",
    cameraAvailable: camera.available.latest,
    cameraLoading: camera.available.loading,
    cameraHint: language.t(cameraHint()),
  }))
  return (
    <ReactView
      component={ServerDialog}
      props={{
        source,
        change: form.change,
        submit: form.submit,
        close: modal.close,
        scan: {
          ...form.scan,
          stop: () => {
            form.scan.stop()
            void camera.refetch()
          },
        },
      }}
    />
  )
}

export type ServerFormController = ReturnType<typeof createFormController>

function createFormController(options: { onSelect?: (server: ServerConnection.Http) => void } = {}) {
  const platform = usePlatform()
  const server = useServers()
  const tabs = useTabs()
  const global = useGlobal()
  const language = useLanguage()
  const checkServerHealth = useCheckServerHealth()
  const redeem = useRedeemPairing()
  const healthPreview = createServerHealthPreview(checkServerHealth)

  const [store, setStore] = createStore<{
    mode: FormMode
    method: ConnectMethod
    originalUrl: string | undefined
    link: string
    values: ServerFormValues
    scanning: boolean
    error: string
    status: boolean | undefined
  }>({
    mode: "list",
    method: "link",
    originalUrl: undefined,
    link: "",
    values: { url: "", name: "", password: "" },
    scanning: false,
    error: "",
    status: undefined,
  })

  onCleanup(healthPreview.cancel)

  const reset = () => {
    healthPreview.cancel()
    setStore({
      mode: "list",
      method: "link",
      originalUrl: undefined,
      link: "",
      values: { url: "", name: "", password: "" },
      scanning: false,
      error: "",
      status: undefined,
    })
  }

  const allServers = () => {
    return server.list
  }

  const editing = createMemo(() =>
    allServers().find((item) => item.type === "http" && item.http.url === store.originalUrl),
  )

  const add = (connection: ServerConnection.Http) => server.add(connection)

  const replace = (originalKey: ServerConnection.Key, next: ServerConnection.Http) =>
    replaceServerConnection(originalKey, next, {
      removeTabs: (key) => tabs.removeServer(key),
      add,
      remove: (key) => server.remove(key),
    })

  // A pairing token works on every address of its server. Signing in again to the edited server keeps its address
  // (e.g. localhost) even when the link names another one (e.g. 127.0.0.1 from opencode pair).
  const paired = async (pairing: Pairing) => {
    const original = store.mode === "edit" ? editing() : undefined

    if (!original || original.http.url === pairing.url) return pairing
    const http = { url: original.http.url, password: pairing.password }

    return (await checkServerHealth(http)).healthy ? http : pairing
  }

  // Where the form points: a scanned or pasted pairing link wins, else the address and password fields.
  const target = async (): Promise<ServerConnection.HttpBase | undefined> => {
    if (store.method === "link") {
      const redeemed = await redeem(store.link)

      if (redeemed && "error" in redeemed) return void setStore("error", redeemed.error)

      if (redeemed) return paired(redeemed.pairing)
      // A server address typed here belongs to the password form.
      const address = bareServerAddress(store.link)

      if (address) {
        setStore({ method: "password", link: "", values: { ...store.values, url: address } })
        preview()

        return
      }

      return void setStore("error", language.t("server.access.invalidLink"))
    }

    // A pairing link pasted into the address field still pairs.
    const redeemed = await redeem(store.values.url)

    if (redeemed && "error" in redeemed) return void setStore("error", redeemed.error)

    if (redeemed) return paired(redeemed.pairing)
    const url = normalizeServerUrl(store.values.url)

    if (!url) return void reset()

    return { url, password: store.values.password || undefined }
  }

  const request = useMutation(() => ({
    mutationFn: async () => {
      const http = await target()

      if (!http) return
      const normalized = http.url
      const original = store.mode === "edit" ? editing() : undefined

      if (store.mode === "edit" && !original) return
      const name = store.values.name.trim() || undefined
      const password = http.password

      // Nothing changed: close, unless the server rejects these credentials, so saving checks them and the action that
      // asked for sign-in can continue.
      if (
        original?.type === "http" &&
        !global.servers.health[ServerConnection.key(original)]?.unauthorized &&
        normalized === original.http.url &&
        name === original.displayName &&
        password === original.http.password
      ) {
        reset()

        return
      }

      const connection: ServerConnection.Http = {
        type: "http",
        displayName: name,
        http: {
          url: normalized,
          password,
        },
      }

      const result = await checkServerHealth(connection.http)

      if (!result.healthy) {
        setStore(
          "error",
          language.t(
            platform.platform === "web" && isMixedContent(location.href, normalized)
              ? "server.connect.mixedContent"
              : "dialog.server.add.error",
          ),
        )

        return
      }

      if (original?.type === "http") {
        if (normalized === original.http.url) add(connection)

        if (normalized !== original.http.url) replace(ServerConnection.key(original), connection)
        reset()
        options.onSelect?.(connection)

        return
      }

      reset()
      add(connection)
      options.onSelect?.(connection)
    },
  }))

  const preview = () => {
    // A pairing link is not a server address until it is redeemed, and redeeming spends it.
    if (store.method === "link" || pairingLink(store.values.url)) {
      healthPreview.cancel()
      setStore("status", undefined)

      return
    }

    void healthPreview.preview(store.values, (status) => setStore("status", status))
  }

  const change = (field: keyof ServerFormValues, value: string) => {
    if (request.isPending) return
    setStore("values", field, value)
    setStore("error", "")

    if (field !== "name") preview()
  }

  const startAdd = () => {
    reset()
    setStore("mode", "add")
  }

  const startEdit = (connection: ServerConnection.Http) => {
    reset()
    setStore({
      mode: "edit",
      // A signed-out server needs a new pairing link; otherwise editing starts from its address.
      method: global.servers.health[ServerConnection.key(connection)]?.unauthorized ? "link" : "password",
      originalUrl: connection.http.url,
      values: {
        url: connection.http.url,
        name: connection.displayName ?? "",
        password: connection.http.password ?? "",
      },
      error: "",
      status: global.servers.health[ServerConnection.key(connection)]?.healthy,
    })
  }

  const submit = () => {
    if (store.mode === "list" || request.isPending) return
    setStore("error", "")
    request.mutate()
  }

  const pair = (link: string) => {
    healthPreview.cancel()
    setStore({ method: "link", link, scanning: false, error: "" })
    request.mutate()
  }

  createEffect(() => {
    if (store.mode !== "edit") return

    if (editing()) return
    reset()
  })

  return {
    state: {
      mode: () => store.mode,
      open: () => store.mode !== "list",
      adding: () => store.mode === "add",
      busy: () => request.isPending,
      method: () => store.method,
      link: () => store.link,
      value: () => store.values.url,
      name: () => store.values.name,
      password: () => store.values.password,
      scanning: () => store.scanning,
      error: () => store.error,
      status: () => store.status,
      signedOut: () => {
        const original = editing()

        return !!original && !!global.servers.health[ServerConnection.key(original)]?.unauthorized
      },
    },
    change: {
      method: (method: ConnectMethod) => {
        if (request.isPending) return
        setStore({ method, error: "" })
        preview()
      },
      link: (value: string) => {
        if (request.isPending) return
        setStore({ link: value, error: "" })
      },
      value: (value: string) => change("url", value),
      name: (value: string) => change("name", value),
      password: (value: string) => change("password", value),
    },
    scan: {
      start: () => setStore("scanning", true),
      stop: () => setStore("scanning", false),
      complete: pair,
      redeem,
    },
    start: { add: startAdd, edit: startEdit },
    reset,
    submit,
  }
}
