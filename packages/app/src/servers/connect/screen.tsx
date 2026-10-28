import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { ConnectServerView } from "./screen.react"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCheckServerHealth } from "@/runtime/server/health"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { bareServerAddress, serverAddress, type Pairing } from "./pairing"
import { useRedeemPairing } from "./redeem"
import { isMixedContent } from "./browser"
import { cameraHint, createCameraAvailability } from "./camera"
import type { ConnectMethod } from "./method"
import "./screen.css"

export function ConnectServerScreen(props: { url?: string } = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const check = useCheckServerHealth()
  const redeem = useRedeemPairing()
  const camera = createCameraAvailability()

  const [state, setState] = createStore<{
    method: ConnectMethod
    link: string
    url: string
    password: string
    error: string
    scanning: boolean
  }>({
    method: "link",
    link: "",
    url: props.url ?? "",
    password: "",
    error: "",
    scanning: false,
  })

  // A pairing token works on every address of its server. Signing in again to the server that signed out keeps its
  // address (e.g. localhost) even when the link names another one (e.g. 127.0.0.1 from opencode pair).
  const target = async (pairing: Pairing) => {
    if (!props.url || props.url === pairing.url) return pairing
    const http = { url: props.url, password: pairing.password }

    return (await check(http)).healthy ? http : pairing
  }

  const connect = async (http: ServerConnection.HttpBase) => {
    const result = await check(http)

    if (!result.healthy) {
      setState("error", connectionError(http.url))

      return
    }

    // Signing in again keeps the name the user gave this server.
    const existing = servers.list.find(
      (server): server is ServerConnection.Http => server.type === "http" && server.http.url === http.url,
    )

    servers.add(existing ? { ...existing, http } : { type: "http", http })
  }

  const connectionError = (url: string) =>
    language.t(
      platform.platform === "web" && isMixedContent(location.href, url)
        ? "server.connect.mixedContent"
        : "server.connect.failed",
    )

  const request = useMutation(() => ({
    mutationFn: async () => {
      if (state.method === "link") {
        const redeemed = await redeem(state.link)

        if (redeemed && "error" in redeemed) return void setState("error", redeemed.error)

        if (redeemed) return connect(await target(redeemed.pairing))
        // A server address typed here belongs to the password form.
        const address = bareServerAddress(state.link)

        if (address) return void setState({ method: "password", url: address, link: "", error: "" })

        return void setState("error", language.t("server.access.invalidLink"))
      }

      // A pairing link pasted into the address field still pairs.
      const redeemed = await redeem(state.url)

      if (redeemed && "error" in redeemed) return void setState("error", redeemed.error)

      if (redeemed) return connect(await target(redeemed.pairing))
      const url = serverAddress(state.url)

      if (!url) return void setState("error", language.t("server.connect.address.invalid"))

      await connect({ url, password: state.password || undefined })
    },
    onError: () => setState("error", connectionError(state.method === "link" ? state.link : state.url)),
  }))

  const submit = () => {
    if (request.isPending) return
    setState("error", "")
    request.mutate()
  }

  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    state: { ...state },
    busy: request.isPending,
    web: platform.platform === "web",
    cameraAvailable: camera.available.latest,
    cameraLoading: camera.available.loading,
    cameraHint: language.t(cameraHint()),
  }))
  return (
    <ReactView
      component={ConnectServerView}
      props={{
        source,
        submit,
        update: (patch: Partial<typeof state>) => setState(patch),
        redeem,
        scan: (link: string) => {
          setState({ method: "link", link, error: "", scanning: false })
          request.mutate()
        },
        stopScan: () => {
          setState("scanning", false)
          void camera.refetch()
        },
      }}
    />
  )
}
