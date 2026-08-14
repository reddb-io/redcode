import type { RedskilledStatusResponse, RedskilledWorkerSteerStatusResponse } from "@opencode-ai/sdk/v2"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

export const { use: useRedskilled, provider: RedskilledProvider } = createSimpleContext({
  name: "Redskilled",
  init: () => {
    const sdk = useSDK()
    const [status, setStatus] = createSignal<RedskilledStatusResponse>()
    const [scope, setScope] = createSignal<"project" | "host">("project")
    const [active, setActive] = createSignal(false)
    const [loading, setLoading] = createSignal(true)

    const load = async () => {
      await sdk.client.redskilled
        .status({ scope: scope() }, { throwOnError: true })
        .then((result) => setStatus(result.data))
        .catch(() => undefined)
        .finally(() => setLoading(false))
    }

    const apply = async (request: Promise<{ data: RedskilledStatusResponse }>) => {
      const result = await request
      setStatus(result.data)
      return result.data
    }

    let timer: Timer | undefined
    createEffect(() => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => void load(), active() ? 1_000 : 5_000)
    })
    onMount(() => void load())
    onCleanup(() => {
      if (timer) clearInterval(timer)
    })

    return {
      status,
      scope,
      loading,
      setActive,
      setScope(value: "project" | "host") {
        setScope(value)
        setLoading(true)
        void load()
      },
      refresh: load,
      consent: (decision: "accepted" | "refused") =>
        apply(sdk.client.redskilled.consent({ decision }, { throwOnError: true })),
      resize: (target: number) => apply(sdk.client.redskilled.project.resize({ target }, { throwOnError: true })),
      stopProject: () => apply(sdk.client.redskilled.project.stop({}, { throwOnError: true })),
      stopWorker: (worker: string) => apply(sdk.client.redskilled.worker.stop({ worker }, { throwOnError: true })),
      recycleWorker: (worker: string) =>
        apply(sdk.client.redskilled.worker.recycle({ worker }, { throwOnError: true })),
      steerWorker: (worker: string, text: string) =>
        apply(sdk.client.redskilled.worker.steer({ worker, text }, { throwOnError: true })),
      steerStatus: (worker: string): Promise<RedskilledWorkerSteerStatusResponse> =>
        sdk.client.redskilled.worker.steerStatus({ worker }, { throwOnError: true }).then((result) => result.data),
    }
  },
})
