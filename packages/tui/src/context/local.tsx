import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { ReasoningAuto } from "@reddb-io/redcode-core/session/reasoning-auto"
import { batch, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { IntelligenceClient } from "@reddb-io/redcode-client"
import type { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { useSync } from "./sync"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import { useTheme } from "./theme"
import { useToast } from "../ui/toast"
import { useRoute } from "./route"
import { usePermission } from "./permission"
import { latestServed, migrateModelState, resolveModel, routerLabel, servingVariants } from "../util/model-origin"

export type LocalTheme = {
  secondary: RGBA
  accent: RGBA
  success: RGBA
  warning: RGBA
  primary: RGBA
  error: RGBA
  info: RGBA
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: providerID,
    modelID: rest.join("/"),
  }
}

export function recentModels(
  model: { providerID: string; modelID: string },
  recent: { providerID: string; modelID: string }[],
) {
  const seen = new Set<string>()
  return [model, ...recent]
    .filter((item) => {
      const key = `${item.providerID}/${item.modelID}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

export const {
  use: useLocal,
  provider: LocalProvider,
  context: LocalContext,
} = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()
    const theme = useTheme().theme
    const route = useRoute()
    const paths = useTuiPaths()
    const args = useArgs()
    const event = useEvent()
    const permission = usePermission()
    const abort = new AbortController()
    const intelligenceAPI = IntelligenceClient.make({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      headers: sdk.headers,
      signal: abort.signal,
    })
    const [intelligenceState, setIntelligence] = createStore({
      status: undefined as Intelligence.Status | undefined,
      error: "",
      loaded: false,
    })
    const pending = { request: undefined as Promise<boolean> | undefined }
    const intelligence = {
      state: intelligenceState,
      // Single reasoning (the unconfigured default) runs on the selected model and needs no setup.
      // Older servers omit `effective`; an enabled evaluator there means dual.
      reasoning: (): Intelligence.Reasoning => {
        const status = intelligenceState.status
        if (!status) return "single"
        if (status.effective) return status.effective.reasoning
        return status.settings.reasoning ?? (status.settings.enabled && status.settings.evaluator ? "dual" : "single")
      },
      ready: () =>
        !intelligenceState.error &&
        (intelligence.reasoning() === "single" ||
          Boolean(
            intelligenceState.status?.settings.enabled &&
              intelligenceState.status.settings.principal &&
              intelligenceState.status.settings.evaluator,
          )),
      refresh() {
        return (pending.request ??= intelligenceAPI
          .get()
          .then((status) => {
            if (!status?.settings) throw new Error("Invalid intelligence status")
            setIntelligence({ status, error: "", loaded: true })
            return intelligence.ready()
          })
          .catch(() => {
            if (!abort.signal.aborted)
              setIntelligence({ error: "Cannot check S1/S2 configuration. Reconnect and retry.", loaded: true })
            return false
          })
          .finally(() => {
            pending.request = undefined
          }))
      },
    }
    onMount(() => void intelligence.refresh())
    onCleanup(() => abort.abort())

    // An id a router renamed resolves to the model's current id.
    function resolveRef(model: { providerID: string; modelID: string }) {
      const found = resolveModel(sync.data.provider.find((item) => item.id === model.providerID), model.modelID)
      if (!found) return undefined
      return { providerID: model.providerID, modelID: found.modelID }
    }

    function isModelValid(model: { providerID: string; modelID: string }) {
      return !!resolveRef(model)
    }

    function getFirstValidModel(...modelFns: (() => { providerID: string; modelID: string } | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        const resolved = resolveRef(model)
        if (resolved) return resolved
      }
    }

    function createAgent() {
      const agents = createMemo(() => sync.data.agent.filter((agent) => agent.mode !== "subagent" && !agent.hidden))
      const visibleAgents = createMemo(() => sync.data.agent.filter((agent) => !agent.hidden))
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
      })
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
        theme.info,
      ])
      return {
        list() {
          return agents()
        },
        current() {
          return agents().find((x) => x.name === agentStore.current) ?? agents().at(0)
        },
        set(name: string) {
          if (!agents().some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((x) => x.name === current.name) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const index = visibleAgents().findIndex((x) => x.name === name)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) {
            const color = agent.color
            if (color.startsWith("#")) return RGBA.fromHex(color)
            // already validated by config, just satisfying TS here
            return theme[color as keyof typeof theme] as RGBA
          }
          return colors()[index % colors().length]
        },
      }
    }

    const agent = createAgent()

    function createModel() {
      const [modelStore, setModelStore] = createStore<{
        ready: boolean
        model: Record<
          string,
          {
            providerID: string
            modelID: string
          }
        >
        recent: {
          providerID: string
          modelID: string
        }[]
        favorite: {
          providerID: string
          modelID: string
        }[]
        variant: Record<string, string | undefined>
      }>({
        ready: false,
        model: {},
        recent: [],
        favorite: [],
        variant: {},
      })

      const filePath = path.join(paths.state, "model.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, {
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          variant: modelStore.variant,
        })
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const value = x as Record<string, unknown>
          if (Array.isArray(value.recent)) setModelStore("recent", value.recent)
          if (Array.isArray(value.favorite)) setModelStore("favorite", value.favorite)
          if (typeof value.variant === "object" && value.variant !== null)
            setModelStore("variant", value.variant as Record<string, string | undefined>)
        })
        .catch(() => {})
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
        })

      // Routers rename model ids (RedRouter moved to readable ids); saved choices follow once providers load.
      createEffect(() => {
        if (!modelStore.ready || sync.data.provider.length === 0) return
        const next = migrateModelState(sync.data.provider, {
          model: modelStore.model,
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          variant: modelStore.variant,
        })
        if (!next) return
        batch(() => {
          setModelStore("model", reconcile(next.model))
          setModelStore("recent", next.recent)
          setModelStore("favorite", next.favorite)
          setModelStore("variant", reconcile(next.variant))
        })
        save()
      })

      const fallbackModel = createMemo(() => {
        const requested = args.model ? resolveRef(parseModel(args.model)) : undefined
        if (requested) return requested

        const principal = intelligenceState.status?.settings.principal
        if (intelligence.ready() && principal) {
          return { providerID: principal.providerID, modelID: principal.id }
        }

        const configured = sync.data.config.model ? resolveRef(parseModel(sync.data.config.model)) : undefined
        if (configured) return configured

        const recent = modelStore.recent.map(resolveRef).find((item) => item !== undefined)
        if (recent) return recent

        const provider = sync.data.provider[0]
        if (!provider) return undefined
        const defaultModel = sync.data.provider_default[provider.id]
        const firstModel = Object.values(provider.models)[0]
        const model = defaultModel ?? firstModel?.id
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
      })

      const currentModel = createMemo(() => {
        const a = agent.current()
        return (
          getFirstValidModel(
            () => a && modelStore.model[a.name],
            () => a && a.model,
            fallbackModel,
          ) ?? undefined
        )
      })

      return {
        current: currentModel,
        get ready() {
          return modelStore.ready
        },
        recent() {
          return modelStore.recent
        },
        favorite() {
          return modelStore.favorite
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
              router: undefined,
              upstream: undefined,
            }
          }
          const provider = sync.data.provider.find((item) => item.id === value.providerID)
          const info = provider?.models[value.modelID]
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? value.modelID,
            reasoning: info?.capabilities?.reasoning ?? false,
            router: provider ? routerLabel(provider) : undefined,
            upstream: info?.upstream?.name,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentModel()
          if (!current) return
          const recent = modelStore.recent
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          if (index === -1) return
          let next = index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          const a = agent.current()
          if (!a) return
          setModelStore("model", a.name, { ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentModel()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          const a = agent.current()
          if (!a) return
          setModelStore("model", a.name, { ...next })
          setModelStore("recent", recentModels(next, modelStore.recent))
          save()
        },
        set(input: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            const model = resolveRef(input)
            if (!model) {
              toast.show({
                message: `Model ${input.providerID}/${input.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const a = agent.current()
            if (!a) return
            setModelStore("model", a.name, model)
            if (options?.recent) {
              setModelStore("recent", recentModels(model, modelStore.recent))
              save()
            }
          })
        },
        toggleFavorite(input: { providerID: string; modelID: string }) {
          batch(() => {
            const model = resolveRef(input)
            if (!model) {
              toast.show({
                message: `Model ${input.providerID}/${input.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const exists = modelStore.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            const next = exists
              ? modelStore.favorite.filter((x) => x.providerID !== model.providerID || x.modelID !== model.modelID)
              : [model, ...modelStore.favorite]
            setModelStore(
              "favorite",
              next.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
            )
            save()
          })
        },
        /** Drops recents, favorites and per-agent choices of a provider that is gone, so it does not come back later. */
        forgetProvider(providerID: string) {
          batch(() => {
            setModelStore(
              "recent",
              modelStore.recent.filter((item) => item.providerID !== providerID),
            )
            setModelStore(
              "favorite",
              modelStore.favorite.filter((item) => item.providerID !== providerID),
            )
            setModelStore(
              "model",
              reconcile(
                Object.fromEntries(
                  Object.entries(modelStore.model).filter(([, item]) => item.providerID !== providerID),
                ),
              ),
            )
            save()
          })
        },
        variant: {
          selected() {
            const m = currentModel()
            if (!m) return undefined
            const key = `${m.providerID}/${m.modelID}`
            return modelStore.variant[key]
          },
          current() {
            const v = this.selected()
            if (!v) return undefined
            if (!this.list().includes(v)) return undefined
            return v
          },
          list() {
            const m = currentModel()
            if (!m) return []
            const provider = sync.data.provider.find((item) => item.id === m.providerID)
            const info = provider?.models[m.modelID]
            if (!info?.variants) return []
            // While a fallback combo's member other than its lead serves this session, its levels apply.
            const served =
              route.data.type === "session"
                ? latestServed(sync.data.message[route.data.sessionID] ?? [], (id) => sync.data.part[id] ?? [], m)
                : undefined
            // `auto` first when the model has effort levels for it to choose between.
            return ReasoningAuto.options(servingVariants(info, served) ?? Object.keys(info.variants))
          },
          set(value: string | undefined) {
            const m = currentModel()
            if (!m) return
            const key = `${m.providerID}/${m.modelID}`
            setModelStore("variant", key, value ?? "default")
            save()
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            const current = this.current()
            if (!current) {
              this.set(variants[0])
              return
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return
            }
            this.set(variants[index + 1])
          },
        },
      }
    }

    const model = createModel()

    function createSession() {
      const [sessionStore, setSessionStore] = createStore<{
        ready: boolean
        pinned: string[]
      }>({
        ready: false,
        pinned: [],
      })

      const filePath = path.join(paths.state, "session.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!sessionStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, {
          pinned: sessionStore.pinned,
        })
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const pinned = (x as Record<string, unknown>).pinned
          if (Array.isArray(pinned))
            setSessionStore(
              "pinned",
              pinned.filter((item): item is string => typeof item === "string"),
            )
        })
        .catch(() => {})
        .finally(() => {
          setSessionStore("ready", true)
          if (state.pending) save()
        })

      const slots = createMemo(() => {
        const existing = new Set(sync.data.session.filter((x) => x.parentID === undefined).map((x) => x.id))
        return sessionStore.pinned.filter((id) => existing.has(id)).slice(0, 9)
      })

      function prune(sessionID: string) {
        batch(() => {
          if (sessionStore.pinned.includes(sessionID)) {
            setSessionStore(
              "pinned",
              sessionStore.pinned.filter((x) => x !== sessionID),
            )
          }
          save()
        })
      }

      event.on("session.deleted", (evt) => {
        prune(evt.properties.info.id)
      })

      return {
        get ready() {
          return sessionStore.ready
        },
        pinned() {
          return sessionStore.pinned
        },
        slots,
        isPinned(sessionID: string) {
          return sessionStore.pinned.includes(sessionID)
        },
        togglePin(sessionID: string) {
          batch(() => {
            const exists = sessionStore.pinned.includes(sessionID)
            const next = exists
              ? sessionStore.pinned.filter((x) => x !== sessionID)
              : [...sessionStore.pinned, sessionID]
            setSessionStore("pinned", next)
            save()
          })
        },
        quickSwitch(slot: number) {
          const target = slots()[slot - 1]
          if (!target) return
          if (route.data.type === "session" && route.data.sessionID === target) return
          route.navigate({ type: "session", sessionID: target })
        },
      }
    }

    const session = createSession()

    const mcp = {
      isEnabled(name: string) {
        const status = sync.data.mcp[name]
        return status?.status === "connected"
      },
      async toggle(name: string) {
        const status = sync.data.mcp[name]
        if (status?.status === "connected") {
          // Disable: disconnect the MCP
          await sdk.client.mcp.disconnect({ name })
        } else {
          // Enable/Retry: connect the MCP (handles disabled, failed, and other states)
          await sdk.client.mcp.connect({ name })
        }
      },
    }

    createEffect(() => {
      const value = agent.current()
      if (!value?.model) return
      if (isModelValid(value.model)) return
      toast.show({
        variant: "warning",
        message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
        duration: 3000,
      })
    })

    const result = {
      intelligence,
      model,
      agent,
      mcp,
      session,
      permission,
    }
    return result
  },
})
