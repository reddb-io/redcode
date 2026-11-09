import { useQuery } from "@tanstack/solid-query"
import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { loadHistory, recordHistory } from "@/shell/navigation/resource-history"
import type { HomeController } from "./model"
import { HomeRuntimeView } from "./runtime.react"

type DesktopMemorySample = { pid: number; createdAt: number; type: string; residentBytes: number | null }[]
type RuntimeNotice = "disconnected" | "unavailable" | "executionUnavailable" | "partial" | undefined

const unavailableStorage = { getItem: () => null, setItem: () => {} }
function storage() {
  try {
    return window.localStorage
  } catch {
    return unavailableStorage
  }
}

export function HomeRuntime(props: { home: HomeController; open: () => void }) {
  const language = useLanguage()
  const [state, setState] = createStore({ history: 0 })
  const server = props.home.server.focused
  const context = props.home.server.focusedContext
  const key = () => {
    const value = server()
    return value ? ServerConnection.key(value) : ""
  }
  const connected = () => context()?.sdk.connection.status() === "connected"
  const resources = useQuery(() => ({
    queryKey: ["host-resources", `${key()}:`],
    queryFn: ({ signal }) => context()!.sdk.api.server.resources({ signal }),
    enabled: !!context() && connected(),
    retry: false,
    refetchInterval: (query) => (query.state.status === "error" ? false : 5000),
  }))
  const memory = useQuery(() => ({
    queryKey: ["execution-memory", `${key()}:`],
    queryFn: ({ signal }) => context()!.sdk.api.server.memory({ signal }),
    enabled: !!context() && connected(),
    retry: false,
    refetchInterval: (query) => (query.state.status === "error" ? false : 30_000),
  }))
  const system = useQuery(() => ({
    queryKey: ["server-system", `${key()}:`],
    queryFn: ({ signal }) => context()!.sdk.api.server.system({ signal }),
    enabled: !!context() && connected(),
    retry: false,
    refetchInterval: 15_000,
  }))
  const performance = useQuery(() => ({
    queryKey: ["model-performance", `${key()}:`],
    queryFn: ({ signal }) => context()!.sdk.api.server.performance({ signal }),
    enabled: !!context() && connected(),
    retry: false,
    refetchInterval: (query) => (query.state.status === "error" ? false : 30_000),
  }))
  const active = useQuery(() => ({
    queryKey: ["session-active", `${key()}:`],
    queryFn: ({ signal }) => context()!.sdk.api.session.active({ signal }),
    enabled: !!context() && connected(),
    retry: false,
    refetchInterval: 5_000,
  }))
  const workers = useQuery(() => ({
    queryKey: ["workers", `${key()}:`],
    queryFn: ({ signal }) => context()!.sdk.api.workers.list({ signal }),
    enabled: !!context() && connected(),
    retry: false,
    refetchInterval: 15_000,
  }))
  const native = (window as Window & { electron?: { getMemorySample?: () => Promise<DesktopMemorySample> } }).electron
  const desktop = useQuery(() => ({
    queryKey: ["desktop-memory"],
    queryFn: () => native!.getMemorySample!(),
    enabled: !!native?.getMemorySample,
    retry: false,
    refetchInterval: 10_000,
  }))
  let last = ""
  createEffect(() => {
    const sample = resources.data
    const connection = key()
    if (!sample || !connection || resources.isError) return
    const identity = `${connection}:`
    const minute = Math.floor(Date.now() / 60_000)
    const bucket = `${identity}:${minute}`
    if (last === bucket) return
    recordHistory(storage(), identity, {
      x: minute * 60_000,
      cpu: sample.cpu.utilization === null ? null : sample.cpu.utilization * 100,
      memory:
        sample.memory.totalBytes === null || sample.memory.freeBytes === null
          ? null
          : (sample.memory.totalBytes - sample.memory.freeBytes) / 1024 ** 3,
      free: sample.memory.freeBytes === null ? null : sample.memory.freeBytes / 1024 ** 3,
      process: sample.process.residentBytes / 1024 ** 3,
    })
    last = bucket
    setState("history", (value) => value + 1)
  })
  const source = sharedSource(() => {
    const current = server()
    const connection = key()
    const identity = `${connection}:`
    void state.history
    const history = connection ? loadHistory(storage(), identity).points : []
    const trend = history.flatMap((point) => (point.process === null ? [] : [point.process]))
    const entries = memory.data?.entries ?? []
    const desktopBytes = desktop.data?.reduce((total, item) => total + (item.residentBytes ?? 0), 0)
    const serverBytes = resources.data?.process.residentBytes
    const activeIDs = Object.keys(active.data ?? {})
    const subagents = activeIDs.filter((id) => context()?.data.session.get(id)?.parentID).length
    const machines = props.home.server.list()
    const focused = server()
    const onlineMachines = machines.filter((machine) => {
      if (focused && ServerConnection.key(machine) === ServerConnection.key(focused)) return connected()
      return props.home.server.health(machine)?.healthy === true
    }).length
    const workerList = workers.data?.workers ?? []
    const serverLatency = focused ? props.home.server.health(focused)?.latencyMs : undefined
    const workerLatencies = workerList
      .flatMap((worker) => (worker.connection === "online" && worker.latencyMs !== undefined ? [worker.latencyMs] : []))
      .toSorted((a, b) => a - b)
    const workerLatency = workerLatencies.length
      ? workerLatencies[Math.floor((workerLatencies.length - 1) / 2)]
      : undefined
    const growth = trend.length >= 3 ? trend.at(-1)! - trend[0]! : 0
    const notice: RuntimeNotice = !connected()
      ? "disconnected"
      : resources.isError
        ? "unavailable"
        : memory.isError
          ? "executionUnavailable"
          : memory.data?.complete === false
            ? "partial"
            : undefined
    return {
      language: sharedLanguage(language),
      server: current ? serverName(current) : "",
      connected: connected(),
      serverBytes,
      desktopBytes: native?.getMemorySample && desktop.data ? desktopBytes : undefined,
      executions: memory.isError ? undefined : entries.length,
      sessions: activeIDs.length - subagents,
      sessionTotal: system.data?.counts?.sessions,
      agents: activeIDs.length,
      subagents,
      machines: machines.length,
      onlineMachines,
      workers: workerList.length,
      onlineWorkers: workerList.filter((worker) => worker.connection === "online").length,
      serverLatency,
      workerLatency,
      clients: system.data?.clients,
      performance: performance.isError ? undefined : performance.data,
      totalBytes: resources.data?.memory.totalBytes ?? undefined,
      cpuPercent:
        resources.data?.cpu.utilization === null || resources.data?.cpu.utilization === undefined
          ? undefined
          : resources.data.cpu.utilization * 100,
      history,
      trend,
      growth,
      notice,
      sampledAt: resources.data?.sampledAt,
    }
  })
  return <ReactView component={HomeRuntimeView} props={{ source, open: props.open }} />
}
