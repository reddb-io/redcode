import type {
  TuiStatuslineContribution,
  TuiPluginApi,
  TuiPluginInstallOptions,
  TuiPluginInstallResult,
  TuiPluginStatus,
} from "@opencode-ai/plugin/tui"
import type { TuiConfig } from "../config"
import { createContext, createSignal, useContext, type JSX, type ParentProps } from "solid-js"
import { createPluginRoutes } from "./api"
import { createSlots, type HostSlots } from "./slots"

export function createPluginRuntime() {
  let statuslineCount = 0
  const [commands, setCommands] = createSignal<PluginRuntimeCommands>(emptyCommands)
  const [status, setStatus] = createSignal<ReadonlyArray<TuiPluginStatus>>([])
  const [statusline, setStatusline] = createSignal<
    ReadonlyArray<{ id: string; contribution: TuiStatuslineContribution }>
  >([])
  const slots = createSlots()

  return {
    Slot: slots.Slot,
    routes: createPluginRoutes(),
    commands,
    status,
    statusline,
    registerStatusline(id: string, contribution: TuiStatuslineContribution) {
      const key = `${id}:${statuslineCount++}`
      let active = true
      const replace = (next: TuiStatuslineContribution) => {
        setStatusline((items) => [...items.filter((item) => item.id !== key), { id: key, contribution: next }])
      }
      replace(contribution)
      return {
        update(next: TuiStatuslineContribution) {
          if (!active) return
          replace(next)
        },
        dispose() {
          if (!active) return
          active = false
          setStatusline((items) => items.filter((item) => item.id !== key))
        },
      }
    },
    update(input: { commands?: PluginRuntimeCommands; status?: ReadonlyArray<TuiPluginStatus> }) {
      if (input.commands) setCommands(input.commands)
      if (input.status) setStatus(input.status)
    },
    clear() {
      setCommands(emptyCommands)
      setStatus([])
      setStatusline([])
      slots.clear()
    },
    setupSlots(api: TuiPluginApi): HostSlots {
      return slots.setup(api)
    },
  }
}

export type PluginRuntimeCommands = {
  activate: (id: string) => Promise<boolean>
  deactivate: (id: string) => Promise<boolean>
  add: (spec: string) => Promise<boolean>
  install: (spec: string, options?: TuiPluginInstallOptions) => Promise<TuiPluginInstallResult>
}

const emptyCommands: PluginRuntimeCommands = {
  async activate() {
    return false
  },
  async deactivate() {
    return false
  },
  async add() {
    return false
  },
  async install() {
    return { ok: false, message: "Plugin runtime is not available." }
  },
}

export type PluginRuntime = ReturnType<typeof createPluginRuntime>

export type TuiPluginHost = {
  start(input: {
    api: TuiPluginApi
    config: TuiConfig.Resolved
    runtime: PluginRuntime
    dispose?: () => void
  }): Promise<void>
  dispose(): Promise<void>
}

const Context = createContext<PluginRuntime>()

export function PluginRuntimeProvider(props: ParentProps<{ value: PluginRuntime }>): JSX.Element {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function usePluginRuntime() {
  const runtime = useContext(Context)
  if (!runtime) throw new Error("usePluginRuntime must be used within PluginRuntimeProvider")
  return runtime
}
