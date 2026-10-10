import { createStore } from "solid-js/store"
import { dedupeWith } from "effect/Array"
import { createSimpleContext } from "./helper"
import { batch, createMemo, createResource, onCleanup } from "solid-js"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import {
  createModelPreferenceRepository,
  cycleModelVariant,
  normalizeModelVariant,
  type ModelPreference,
  type ModelPreferenceModel,
} from "../model-preference"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { useTheme } from "./theme"
import { useToast } from "../ui/toast"
import { useRoute } from "./route"
import { useData } from "./data"
import { usePermission } from "./permission"
import { useLocation } from "./location"
import { useClient } from "./client"
import { parse } from "../util/model"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const data = useData()
    const toast = useToast()
    const theme = useTheme()
    const route = useRoute()
    const paths = useTuiPaths()
    const args = useArgs()
    const event = useEvent()
    const permission = usePermission()
    const location = useLocation()
    const client = useClient()

    const models = () => data.location.model.list(location.ref)
    const providers = () => data.location.provider.list(location.ref)

    function isModelValid(model: ModelPreferenceModel) {
      // A saved connection can have a different catalog from the currently active account.
      // Keep the selection so the server resolves it or reports why that access is unavailable.
      if (model.connection) return true
      return !!models()?.some((item) => item.providerID === model.providerID && item.id === model.modelID)
    }

    function getFirstValidModel(...modelFns: (() => ModelPreferenceModel | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (model && isModelValid(model)) return model
      }
    }

    function createAgent() {
      const agents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden),
      )
      const visibleAgents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => !agent.hidden),
      )
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
        draftBySession: {} as Record<string, { agent?: string } | undefined>,
      })
      onCleanup(event.on("session.deleted", (evt) => setAgentStore("draftBySession", evt.data.sessionID, undefined)))
      onCleanup(
        event.on("session.agent.selected", (evt) => {
          // Keep an entry after acknowledgment: CLI defaults must not override a user's later choice.
          if (agentStore.draftBySession[evt.data.sessionID]?.agent === evt.data.agent)
            setAgentStore("draftBySession", evt.data.sessionID, { agent: undefined })
        }),
      )
      const colors = createMemo(() => {
        const step = 200
        return dedupeWith(
          theme.categorical.map((scale) => scale[step]),
          (first, second) => first.equals(second),
        )
      })
      return {
        list() {
          return agents()
        },
        current() {
          const draft = route.data.type === "session" ? agentStore.draftBySession[route.data.sessionID] : undefined
          const selected =
            route.data.type === "session"
              ? (draft?.agent ??
                (draft ? undefined : args.agent) ??
                data.session.get(route.data.sessionID)?.agent ??
                agentStore.current)
              : agentStore.current
          return agents().find((agent) => agent.id === selected) ?? agents().at(0)
        },
        set(id: string) {
          if (!agents().some((agent) => agent.id === id))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${id}`,
              duration: 3000,
            })
          batch(() => {
            const changed = this.current()?.id !== id
            if (changed) model.remember()
            setAgentStore("current", id)
            if (route.data.type === "session") setAgentStore("draftBySession", route.data.sessionID, { agent: id })
            // Retain both selections while agent and model commits arrive separately.
            const selected = changed && route.data.type === "session" ? model.current() : undefined
            if (selected) model.set(selected)
          })
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((agent) => agent.id === current.id) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            this.set(value.id)
          })
        },
        color(id: string) {
          const index = visibleAgents().findIndex((agent) => agent.id === id)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) return RGBA.fromHex(agent.color)
          // Built-in identities must survive provider/plugin agent ordering changes.
          const builtin = ["build", "plan", "design", "question"].indexOf(id)
          return colors()[(builtin === -1 ? index : builtin) % colors().length]
        },
      }
    }

    const agent = createAgent()

    function createModel() {
      type ModelSelection = ModelPreferenceModel & { variant?: string }
      const [reasoningStatus, reasoning] = createResource(() => client.api["server.intelligence"].status())
      const [preferences, setPreferences] = createStore<ModelPreference & { ready: boolean }>({
        ready: false,
        recent: [],
        favorite: [],
        variant: {},
      })
      const [selectionState, setSelectionState] = createStore<{
        newSessionModelByLocationAgent: Record<string, ModelPreferenceModel | undefined>
        selectionBySessionAgent: Record<string, Record<string, ModelSelection | undefined> | undefined>
      }>({
        newSessionModelByLocationAgent: {},
        selectionBySessionAgent: {},
      })

      const repository = createModelPreferenceRepository(path.join(paths.state, "model.json"))
      const pendingSelectionCommits = new Map<
        string,
        { agentID: string; selection: string; connection?: ModelPreferenceModel["connection"] }
      >()
      const selectionKey = (value: ModelSelection) =>
        `${ModelPresentation.preferenceKey(value)}:${normalizeModelVariant(value.variant) ?? "default"}:${JSON.stringify(value.connection)}`

      function applyPreferences(value: ModelPreference) {
        batch(() => {
          setPreferences("recent", value.recent)
          setPreferences("favorite", value.favorite)
          setPreferences("variant", value.variant)
          setPreferences("ready", true)
        })
      }

      onCleanup(repository.subscribe(applyPreferences))

      const configuredModel = createMemo(() => {
        const entry = data.location.config
          .list(location.ref)
          ?.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
        const configured = entry?.type === "document" ? entry.info.model : undefined
        if (!configured) return
        return typeof configured === "string"
          ? { ...parse(configured), variant: undefined }
          : { providerID: configured.providerID, modelID: configured.model, variant: configured.variant }
      })

      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = parse(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        const configured = configuredModel()
        if (configured && isModelValid(configured)) return configured

        const principal = reasoningStatus()?.settings.principal
        if (
          principal &&
          isModelValid({ providerID: principal.providerID, modelID: principal.id, connection: principal.connection })
        )
          return { providerID: principal.providerID, modelID: principal.id, connection: principal.connection }

        for (const item of preferences.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const model = models()?.[0]
        if (!model) return undefined
        return {
          providerID: model.providerID,
          modelID: model.id,
        }
      })

      const newSessionModel = createMemo(() => {
        const a = agent.current()
        return getFirstValidModel(
          () => a && selectionState.newSessionModelByLocationAgent[locationAgentKey(a.id)],
          () => a?.model && { providerID: a.model.providerID, modelID: a.model.id, connection: a.model.connection },
          fallbackModel,
        )
      })

      const currentSelection = createMemo<ModelSelection | undefined>(() => {
        if (route.data.type === "session") return sessionSelection(route.data.sessionID)
        const model = newSessionModel()
        if (!model) return
        return preferredSelection(model)
      })

      const currentModel = createMemo<ModelPreferenceModel | undefined>(() => {
        const selection = currentSelection()
        if (!selection) return
        return { providerID: selection.providerID, modelID: selection.modelID, connection: selection.connection }
      })

      function selectionSource() {
        const current = agent.current()
        if (route.data.type === "session") {
          const session = data.session.get(route.data.sessionID)
          const draft = current && selectionState.selectionBySessionAgent[route.data.sessionID]?.[current.id]
          if (draft && isModelValid(draft)) return "TUI selection"
          if (
            session?.model &&
            (!session.agent || session.agent === current?.id) &&
            isModelValid({ providerID: session.model.providerID, modelID: session.model.id })
          )
            return "session model"
        }
        const selected = current && selectionState.newSessionModelByLocationAgent[locationAgentKey(current.id)]
        if (selected && isModelValid(selected)) return "TUI selection"
        if (current?.model && isModelValid({ providerID: current.model.providerID, modelID: current.model.id }))
          return "agent model"
        if (args.model && isModelValid(parse(args.model))) return "CLI argument"
        const configured = configuredModel()
        if (configured && isModelValid(configured)) return "location config"
        const principal = reasoningStatus()?.settings.principal
        if (principal && isModelValid({ providerID: principal.providerID, modelID: principal.id })) return "global S2"
        if (preferences.recent.some(isModelValid)) return "recent model"
        return "catalog default"
      }

      function locationAgentKey(agentID: string) {
        const ref = location.ref ?? data.location.default()
        return `${JSON.stringify([ref.directory, ref.workspaceID])}:${agentID}`
      }

      function preferredSelection(model: ModelPreferenceModel): ModelSelection {
        const configured = agent.current()?.model
        const fallback = configuredModel()
        const preferred = preferences.variant[ModelPresentation.preferenceKey(model)]
        const variant = normalizeModelVariant(
          preferred ??
            (configured?.providerID === model.providerID && configured.id === model.modelID
              ? configured.variant
              : undefined) ??
            (fallback?.providerID === model.providerID && fallback.modelID === model.modelID
              ? fallback.variant
              : undefined),
        )
        const info = models()?.find((item) => item.providerID === model.providerID && item.id === model.modelID)
        return { ...model, variant: info?.variants.some((item) => item.id === variant) ? variant : undefined }
      }

      function durableSelection(sessionID: string): ModelSelection | undefined {
        const model = data.session.get(sessionID)?.model
        if (!model) return
        return {
          providerID: model.providerID,
          modelID: model.id,
          variant: normalizeModelVariant(model.variant),
          connection: model.connection,
        }
      }

      function sessionSelection(sessionID: string) {
        const current = agent.current()
        if (!current) return
        const session = data.session.get(sessionID)
        const selected = [
          selectionState.selectionBySessionAgent[sessionID]?.[current.id],
          !session?.agent || session.agent === current.id ? durableSelection(sessionID) : undefined,
        ].find((selection) => selection && isModelValid(selection))
        if (selected) {
          const info = models()?.find((item) => item.providerID === selected.providerID && item.id === selected.modelID)
          return {
            ...selected,
            variant: info
              ? info.variants.some((variant) => variant.id === selected.variant)
                ? selected.variant
                : undefined
              : selected.variant,
          }
        }
        const model = newSessionModel()
        return model && preferredSelection(model)
      }

      function setSessionSelection(sessionID: string, agentID: string, selection: ModelSelection | undefined) {
        setSelectionState("selectionBySessionAgent", sessionID, {
          ...selectionState.selectionBySessionAgent[sessionID],
          [agentID]: selection,
        })
      }

      function setSessionDraft(sessionID: string, selection: ModelSelection) {
        const current = agent.current()
        if (!current) return
        const durable = durableSelection(sessionID)
        const session = data.session.get(sessionID)
        setSessionSelection(
          sessionID,
          current.id,
          (!session?.agent || session.agent === current.id) &&
            durable &&
            selectionKey(durable) === selectionKey(selection)
            ? undefined
            : selection,
        )
      }

      function selectModel(model: ModelPreferenceModel) {
        if (route.data.type === "session") {
          const sessionID = route.data.sessionID
          const current = sessionSelection(sessionID)
          setSessionDraft(
            sessionID,
            current?.providerID === model.providerID &&
              current.modelID === model.modelID &&
              JSON.stringify(current.connection) === JSON.stringify(model.connection)
              ? current
              : preferredSelection(model),
          )
          return true
        }
        const current = agent.current()
        if (!current) return false
        setSelectionState("newSessionModelByLocationAgent", locationAgentKey(current.id), model)
        return true
      }

      function reconcileSessionSelection(sessionID: string) {
        const expected = pendingSelectionCommits.get(sessionID)
        const durable = durableSelection(sessionID)
        if (!expected || !durable || data.session.get(sessionID)?.agent !== expected.agentID) return
        if (selectionKey(expected.connection ? durable : { ...durable, connection: undefined }) !== expected.selection)
          return
        pendingSelectionCommits.delete(sessionID)
        // Inactive agents keep their remembered choices after another agent commits.
        if (
          route.data.type !== "session" ||
          route.data.sessionID !== sessionID ||
          agent.current()?.id !== expected.agentID
        )
          return
        const draft = selectionState.selectionBySessionAgent[sessionID]?.[expected.agentID]
        if (draft && selectionKey(draft) === expected.selection)
          setSessionSelection(sessionID, expected.agentID, undefined)
      }

      onCleanup(event.on("session.model.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))
      onCleanup(event.on("session.agent.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))

      onCleanup(
        event.on("session.deleted", (evt) => {
          pendingSelectionCommits.delete(evt.data.sessionID)
          setSelectionState("selectionBySessionAgent", evt.data.sessionID, undefined)
        }),
      )

      return {
        current: currentModel,
        selection: currentSelection,
        source: selectionSource,
        intelligenceStatus: reasoningStatus,
        refreshDefault: reasoning.refetch,
        remember() {
          const current = agent.current()
          const selection = currentSelection()
          if (route.data.type !== "session" || !current || !selection) return
          setSessionSelection(route.data.sessionID, current.id, { ...selection })
        },
        available(model = currentModel()) {
          return model ? isModelValid(model) : false
        },
        trackSessionCommit(
          sessionID: string,
          value: {
            providerID: string
            id: string
            variant?: string
            connection?: ModelPreferenceModel["connection"]
          },
          agentID: string,
        ) {
          const committed = {
            agentID,
            selection: selectionKey({
              providerID: value.providerID,
              modelID: value.id,
              variant: value.variant,
              connection: value.connection,
            }),
            connection: value.connection,
          }
          pendingSelectionCommits.set(sessionID, committed)
          // An unchanged model emits no event; the agent may be the only durable change.
          reconcileSessionSelection(sessionID)
          return () => {
            if (pendingSelectionCommits.get(sessionID) === committed) pendingSelectionCommits.delete(sessionID)
          }
        },
        get ready() {
          return preferences.ready
        },
        get catalogReady() {
          return models() !== undefined
        },
        recent() {
          return preferences.recent
        },
        favorite() {
          return preferences.favorite
        },
        parsed: createMemo(() => {
          const value = currentSelection()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = providers()?.find((item) => item.id === value.providerID)
          const info = models()?.find((item) => item.providerID === value.providerID && item.id === value.modelID)
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? `${value.modelID} (${value.connection ? "saved connection" : "unavailable"})`,
            reasoning: (info?.variants?.length ?? 0) !== 0,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentSelection()
          if (!current) return
          const recent = preferences.recent.filter(isModelValid)
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          let next = index === -1 ? (direction === 1 ? 0 : recent.length - 1) : index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          selectModel({ ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = preferences.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentSelection()
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
          if (!selectModel({ ...next })) return
          setPreferences("recent", ModelPresentation.recentModels(next, preferences.recent))
          void repository.addRecent(next).catch(() => undefined)
        },
        set(model: ModelPreferenceModel, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) return
            if (!selectModel(model)) return
            if (options?.recent) {
              setPreferences("recent", ModelPresentation.recentModels(model, preferences.recent))
              void repository.addRecent(model).catch(() => undefined)
            }
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) return
            const exists = preferences.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            setPreferences("favorite", ModelPresentation.favoriteModels(model, preferences.favorite, !exists))
            void repository.setFavorite(model, !exists).catch(() => undefined)
          })
        },
        variant: {
          selected() {
            return currentSelection()?.variant
          },
          current() {
            return this.selected()
          },
          list() {
            const m = currentSelection()
            if (!m) return []
            const info = models()?.find((item) => item.providerID === m.providerID && item.id === m.modelID)
            return info?.variants?.map((variant) => variant.id) ?? []
          },
          set(value: string | undefined) {
            const m = currentSelection()
            if (!m) return
            if (route.data.type === "session") {
              setSessionDraft(route.data.sessionID, { ...m, variant: normalizeModelVariant(value) })
            }
            setPreferences("variant", ModelPresentation.preferenceKey(m), value ?? "default")
            void repository.saveVariant(m, value).catch(() => undefined)
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            this.set(cycleModelVariant(this.current(), variants))
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
        const existing = new Set(
          data.session
            .list()
            .filter((x) => x.parentID === undefined)
            .map((x) => x.id),
        )
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
        prune(evt.data.sessionID)
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

    const result = {
      model,
      agent,
      session,
      permission,
    }
    return result
  },
})
