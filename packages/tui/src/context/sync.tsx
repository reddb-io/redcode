import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
} from "@reddb-io/redcode-sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, onCleanup, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

function compareMessage(a: Message, b: Message) {
  return a.time.created - b.time.created || a.id.localeCompare(b.id)
}

const messageKey = (message: Message) => message.time.created + message.id
export const SESSION_CACHE_LIMIT = 20

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const permission = usePermission()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      capabilities: {
        experimentalBackgroundSubagents: boolean
      }
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      capabilities: {
        experimentalBackgroundSubagents: false,
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<
      string,
      { messages: Set<string>; parts: Set<string>; fields: Set<string>; abort: AbortController }
    >()
    const cachedSessions = new Map<string, true>()
    const retainedSessions = new Map<string, number>()
    let disposed = false
    let generation = 0
    let bootstrapAbort: AbortController | undefined
    let sessionListGeneration = 0
    let refreshingSessions: { changed: Set<string>; abort: AbortController } | undefined
    let snapshot:
      | {
          sessions: Set<string>
          statuses: Set<string>
          permissions: Set<string>
          questions: Set<string>
          deleted: Set<string>
        }
      | undefined
    onCleanup(() => {
      disposed = true
      generation++
      bootstrapAbort?.abort()
      refreshingSessions?.abort.abort()
      for (const tracker of hydratingSessions.values()) tracker.abort.abort()
      hydratingSessions.clear()
      syncingSessions.clear()
    })

    function evict(sessionID: string, deleted = false) {
      fullSyncedSessions.delete(sessionID)
      syncingSessions.delete(sessionID)
      hydratingSessions.get(sessionID)?.abort.abort()
      hydratingSessions.delete(sessionID)
      cachedSessions.delete(sessionID)
      setStore(
        produce((draft) => {
          for (const [messageID, parts] of Object.entries(draft.part)) {
            if (
              parts.some((part) => part.sessionID === sessionID) ||
              draft.message[sessionID]?.some((message) => message.id === messageID)
            )
              delete draft.part[messageID]
          }
          delete draft.message[sessionID]
          delete draft.todo[sessionID]
          delete draft.session_diff[sessionID]
          if (!deleted) return
          delete draft.session_status[sessionID]
          delete draft.permission[sessionID]
          delete draft.question[sessionID]
        }),
      )
    }

    function trimSessions() {
      const inactive = [...cachedSessions.keys()].filter((id) => !retainedSessions.has(id))
      for (const id of inactive.slice(0, Math.max(0, inactive.length - SESSION_CACHE_LIMIT))) evict(id)
    }

    function cacheSession(sessionID: string) {
      cachedSessions.delete(sessionID)
      cachedSessions.set(sessionID, true)
      trimSessions()
    }
    function touchSession(sessionID: string) {
      snapshot?.sessions.add(sessionID)
      refreshingSessions?.changed.add(sessionID)
    }
    const touchMessage = (sessionID: string, messageID: string) => {
      hydratingSessions.get(sessionID)?.messages.add(messageID)
    }
    const touchPart = (sessionID: string, partID: string) => {
      hydratingSessions.get(sessionID)?.parts.add(partID)
    }

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions(signal?: AbortSignal) {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() }, { signal })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    // The server refreshes the models catalog in the background and drops its provider
    // state; pull the provider list again so newly published models show up without a restart.
    let providerReloadPending = false
    async function reloadProviders() {
      if (store.status === "loading") {
        providerReloadPending = true
        return
      }
      const workspace = project.workspace.current()
      const [providers, providerList] = await Promise.all([
        sdk.client.config.providers({ workspace }, { throwOnError: true }).then((x) => x.data!),
        sdk.client.provider.list({ workspace }, { throwOnError: true }).then((x) => x.data!),
      ]).catch(() => [undefined, undefined] as const)
      if (!providers || !providerList) return
      batch(() => {
        setStore("provider", reconcile(providers.providers))
        setStore("provider_default", reconcile(providers.default))
        setStore("provider_next", reconcile(providerList))
      })
    }

    let mcpRefresh = 0
    event.subscribe((event, { directory, workspace }) => {
      if ("sessionID" in event.properties && typeof event.properties.sessionID === "string") {
        const sessionID = event.properties.sessionID
        if (event.type === "todo.updated" || event.type === "session.diff") cacheSession(sessionID)
        if (event.type === "todo.updated") hydratingSessions.get(sessionID)?.fields.add("todo")
        if (event.type === "session.diff") hydratingSessions.get(sessionID)?.fields.add("diff")
        if (event.type === "session.status") snapshot?.statuses.add(sessionID)
      }
      switch (event.type) {
        case "mcp.tools.changed": {
          if (workspace !== project.workspace.current()) break
          const revision = ++mcpRefresh
          const epoch = generation
          void Promise.all([
            sdk.client.mcp.status({ workspace }, { throwOnError: true }),
            sdk.client.experimental.resource.list({ workspace }, { throwOnError: true }),
          ])
            .then(([status, resources]) => {
              if (
                disposed ||
                generation !== epoch ||
                revision !== mcpRefresh ||
                project.workspace.current() !== workspace
              )
                return
              batch(() => {
                setStore("mcp", reconcile(status.data))
                setStore("mcp_resource", reconcile(resources.data))
              })
            })
            .catch(() => {})
          break
        }
        case "server.instance.disposed":
          void bootstrap()
          break

        case "models-dev.refreshed":
          void reloadProviders()
          break
        case "permission.replied": {
          snapshot?.permissions.add(event.properties.requestID)
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          snapshot?.permissions.add(request.id)
          if (permission.mode === "auto") {
            void sdk.client.permission.reply({
              requestID: request.id,
              reply: "once",
              directory,
              workspace,
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          snapshot?.questions.add(event.properties.requestID)
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          snapshot?.questions.add(request.id)
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          touchSession(event.properties.info.id)
          snapshot?.deleted.add(event.properties.info.id)
          snapshot?.statuses.add(event.properties.info.id)
          evict(event.properties.info.id, true)
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          touchSession(event.properties.info.id)
          hydratingSessions.get(event.properties.info.id)?.fields.add("session")
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.next.moved": {
          touchSession(event.properties.sessionID)
          hydratingSessions.get(event.properties.sessionID)?.fields.add("session")
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          cacheSession(event.properties.info.sessionID)
          touchMessage(event.properties.info.sessionID, event.properties.info.id)
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = search(messages, messageKey(event.properties.info), messageKey)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          touchMessage(event.properties.sessionID, event.properties.messageID)
          const messages = store.message[event.properties.sessionID] ?? []
          const index = messages.findIndex((message) => message.id === event.properties.messageID)
          if (index !== -1) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(index, 1)
              }),
            )
          }
          setStore(
            "part",
            produce((draft) => {
              delete draft[event.properties.messageID]
            }),
          )
          break
        }
        case "message.part.updated": {
          // Parts have no visible owner after message/session eviction. Only an active history
          // read may receive a part before its message; its snapshot supplies that owner.
          if (
            !hydratingSessions.has(event.properties.part.sessionID) &&
            !store.message[event.properties.part.sessionID]?.some(
              (message) => message.id === event.properties.part.messageID,
            )
          )
            break
          cacheSession(event.properties.part.sessionID)
          touchPart(event.properties.part.sessionID, event.properties.part.id)
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = search(parts, event.properties.part.id, (part) => part.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID] ?? []
          if (!parts) break
          const result = search(parts, event.properties.partID, (part) => part.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, event.properties.partID)
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          touchPart(event.properties.sessionID, event.properties.partID)
          const parts = store.part[event.properties.messageID] ?? []
          const result = search(parts, event.properties.partID, (part) => part.id)
          if (result.found) {
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const epoch = ++generation
      const listEpoch = ++sessionListGeneration
      refreshingSessions?.abort.abort()
      refreshingSessions = undefined
      bootstrapAbort?.abort()
      const abort = new AbortController()
      bootstrapAbort = abort
      const current = () => !disposed && epoch === generation
      const tracker = {
        sessions: new Set<string>(),
        statuses: new Set<string>(),
        permissions: new Set<string>(),
        questions: new Set<string>(),
        deleted: new Set<string>(),
      }
      snapshot = tracker
      const refresh = [...new Set([...cachedSessions.keys(), ...retainedSessions.keys()])]
      // Discard old in-flight snapshots before starting another connection/workspace generation.
      fullSyncedSessions.clear()
      for (const tracker of hydratingSessions.values()) tracker.abort.abort()
      hydratingSessions.clear()
      syncingSessions.clear()
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionsPromise = projectPromise.then(() => listSessions(abort.signal))
      const refreshPromise = Promise.allSettled(refresh.map((id) => result.session.sync(id, { refresh: true })))
      const optional = Promise.allSettled([
        sdk.client.command.list({ workspace }, { signal: abort.signal }).then((x) => {
          if (current()) setStore("command", reconcile(x.data ?? []))
        }),
        sdk.client.lsp.status({ workspace }, { signal: abort.signal }).then((x) => {
          if (current()) setStore("lsp", reconcile(x.data ?? []))
        }),
        sdk.client.mcp.status({ workspace }, { signal: abort.signal }).then((x) => {
          if (current()) setStore("mcp", reconcile(x.data ?? {}))
        }),
        sdk.client.experimental.resource.list({ workspace }, { signal: abort.signal }).then((x) => {
          if (current()) setStore("mcp_resource", reconcile(x.data ?? {}))
        }),
        sdk.client.formatter.status({ workspace }, { signal: abort.signal }).then((x) => {
          if (current()) setStore("formatter", reconcile(x.data ?? []))
        }),
        sdk.client.provider.auth({ workspace }, { signal: abort.signal }).then((x) => {
          if (current()) setStore("provider_auth", reconcile(x.data ?? {}))
        }),
        sdk.client.vcs.get({ workspace }, { signal: abort.signal }).then((x) => {
          if (current()) setStore("vcs", reconcile(x.data))
        }),
        project.workspace.sync(),
      ])
      const secondary = Promise.all([
        sdk.client.session.status({ workspace }, { signal: abort.signal }),
        sdk.client.permission.list({ workspace }, { signal: abort.signal }),
        sdk.client.question.list({ workspace }, { signal: abort.signal }),
        sessionsPromise,
      ])
      // Attach a rejection handler immediately while the blocking startup reads are running.
      void secondary.catch(() => {})
      await Promise.all([
        sdk.client.config.providers({ workspace }, { throwOnError: true, signal: abort.signal }),
        sdk.client.provider.list({ workspace }, { throwOnError: true, signal: abort.signal }),
        sdk.client.experimental.capabilities.get({ workspace }, { signal: abort.signal }).catch(() => undefined),
        sdk.client.experimental.console.get({ workspace }, { signal: abort.signal }).catch(() => undefined),
        sdk.client.app.agents({ workspace }, { throwOnError: true, signal: abort.signal }),
        sdk.client.config.get({ workspace }, { throwOnError: true, signal: abort.signal }),
        projectPromise,
      ])
        .then(async ([providers, providerList, capabilities, consoleState, agents, config]) => {
          if (!current()) return
          if (args.continue) {
            const sessions = await sessionsPromise
            if (!current()) return
            if (listEpoch === sessionListGeneration)
              setStore(
                "session",
                reconcile(
                  [
                    ...sessions.filter((session) => !tracker.sessions.has(session.id)),
                    ...store.session.filter((session) => tracker.sessions.has(session.id)),
                  ].toSorted((a, b) => a.id.localeCompare(b.id)),
                ),
              )
          }
          batch(() => {
            setStore("provider", reconcile(providers.data!.providers))
            setStore("provider_default", reconcile(providers.data!.default))
            setStore("provider_next", reconcile(providerList.data!))
            setStore(
              "capabilities",
              "experimentalBackgroundSubagents",
              capabilities?.data?.backgroundSubagents === true,
            )
            setStore("console_state", reconcile(consoleState?.data ?? emptyConsoleState))
            setStore("agent", reconcile(agents.data ?? []))
            setStore("config", reconcile(config.data!))
            if (store.status !== "complete") setStore("status", "partial")
          })
          const [statuses, permissions, questions, sessions] = await secondary
          if (!current()) return
          setStore(
            produce((draft) => {
              if (listEpoch === sessionListGeneration)
                draft.session = [
                  ...sessions.filter((session) => !tracker.sessions.has(session.id)),
                  ...draft.session.filter((session) => tracker.sessions.has(session.id)),
                ].toSorted((a, b) => a.id.localeCompare(b.id))
              if (statuses.data)
                draft.session_status = {
                  ...Object.fromEntries(Object.entries(statuses.data).filter(([id]) => !tracker.statuses.has(id))),
                  ...Object.fromEntries(
                    Object.entries(draft.session_status).filter(([id]) => tracker.statuses.has(id)),
                  ),
                }
              if (permissions.data) {
                const live = Object.values(draft.permission)
                  .flat()
                  .filter((request) => tracker.permissions.has(request.id))
                draft.permission = {}
                for (const request of [
                  ...permissions.data.filter(
                    (request) => !tracker.permissions.has(request.id) && !tracker.deleted.has(request.sessionID),
                  ),
                  ...live,
                ].toSorted((a, b) => a.id.localeCompare(b.id))) {
                  ;(draft.permission[request.sessionID] ??= []).push(request)
                }
              }
              if (questions.data) {
                const live = Object.values(draft.question)
                  .flat()
                  .filter((request) => tracker.questions.has(request.id))
                draft.question = {}
                for (const request of [
                  ...questions.data.filter(
                    (request) => !tracker.questions.has(request.id) && !tracker.deleted.has(request.sessionID),
                  ),
                  ...live,
                ].toSorted((a, b) => a.id.localeCompare(b.id))) {
                  ;(draft.question[request.sessionID] ??= []).push(request)
                }
              }
            }),
          )
          snapshot = undefined
          if (permission.mode === "auto") {
            for (const request of Object.values(store.permission).flat()) {
              void sdk.client.permission.reply({ requestID: request.id, reply: "once", workspace }).catch(() => {})
            }
          }
          if (providerReloadPending) {
            providerReloadPending = false
            void reloadProviders()
          }
          await Promise.all([optional, refreshPromise])
          if (current()) setStore("status", "complete")
        })
        .catch((error) => {
          if (!current()) return
          console.error("tui bootstrap failed", { error: error instanceof Error ? error.message : String(error) })
          if (input.fatal ?? true) return exit(error)
          throw error
        })
        .finally(() => {
          if (current()) snapshot = undefined
        })
    }

    onMount(() => {
      void bootstrap()
      // The stream dropped and came back, so whatever happened in between was never delivered.
      // Re-read rather than trust a picture assembled from a stream with a hole in it.
      onCleanup(sdk.onReconnect(() => void bootstrap({ fatal: false }).catch(() => {})))
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const epoch = ++sessionListGeneration
          refreshingSessions?.abort.abort()
          const tracker = { changed: new Set<string>(), abort: new AbortController() }
          refreshingSessions = tracker
          await listSessions(tracker.abort.signal)
            .then((list) => {
              if (disposed || epoch !== sessionListGeneration) return
              setStore(
                "session",
                reconcile(
                  [
                    ...list.filter((session) => !tracker.changed.has(session.id)),
                    ...store.session.filter((session) => tracker.changed.has(session.id)),
                  ].toSorted((a, b) => a.id.localeCompare(b.id)),
                ),
              )
            })
            .catch((error) => {
              if (disposed || epoch !== sessionListGeneration) return
              throw error
            })
            .finally(() => {
              if (refreshingSessions === tracker) refreshingSessions = undefined
            })
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        retain(sessionID: string) {
          retainedSessions.set(sessionID, (retainedSessions.get(sessionID) ?? 0) + 1)
          let released = false
          return () => {
            if (released) return
            released = true
            const remaining = (retainedSessions.get(sessionID) ?? 1) - 1
            if (remaining) retainedSessions.set(sessionID, remaining)
            if (!remaining) retainedSessions.delete(sessionID)
            trimSessions()
          }
        },
        async sync(sessionID: string, input: { refresh?: boolean } = {}) {
          cacheSession(sessionID)
          if (fullSyncedSessions.has(sessionID) && !input.refresh) return
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const tracker = {
            messages: new Set<string>(),
            parts: new Set<string>(),
            fields: new Set<string>(),
            abort: new AbortController(),
          }
          hydratingSessions.set(sessionID, tracker)
          const task = (async () => {
            const [session, messages, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true, signal: tracker.abort.signal }),
              sdk.client.session.messages({ sessionID, limit: 100 }, { signal: tracker.abort.signal }),
              sdk.client.session.todo({ sessionID }, { signal: tracker.abort.signal }),
              sdk.client.session.diff({ sessionID }, { signal: tracker.abort.signal }),
            ])
            if (disposed || hydratingSessions.get(sessionID) !== tracker) return
            if (!messages.data) return
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                if (match.found && !tracker.fields.has("session")) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                if (!tracker.fields.has("todo") && todo.data) draft.todo[sessionID] = todo.data
                const currentMessages = draft.message[sessionID] ?? []
                const infos = (messages.data ?? []).flatMap((message) => {
                  if (!tracker.messages.has(message.info.id)) return [message.info]
                  const current = currentMessages.find((item) => item.id === message.info.id)
                  return current ? [current] : []
                })
                infos.push(
                  ...currentMessages.filter(
                    (message) => tracker.messages.has(message.id) && !infos.some((item) => item.id === message.id),
                  ),
                )
                infos.sort(compareMessage)
                const removed = [...currentMessages, ...infos.slice(0, -100)]
                const visible = infos.slice(-100)
                const visibleIDs = new Set(visible.map((message) => message.id))
                for (const message of messages.data ?? []) {
                  if (!visibleIDs.has(message.info.id)) {
                    delete draft.part[message.info.id]
                    continue
                  }
                  const currentParts = draft.part[message.info.id] ?? []
                  const parts = message.parts.flatMap((part) => {
                    const current = currentParts.find((item) => item.id === part.id)
                    if (tracker.parts.has(part.id)) return current ? [current] : []
                    if (
                      !input.refresh &&
                      current &&
                      (part.type === "text" || part.type === "reasoning") &&
                      (current.type === "text" || current.type === "reasoning") &&
                      part.text.length === 0 &&
                      current.text.length > 0
                    ) {
                      return [current]
                    }
                    return [part]
                  })
                  parts.push(
                    ...currentParts.filter(
                      (part) => tracker.parts.has(part.id) && !parts.some((item) => item.id === part.id),
                    ),
                  )
                  draft.part[message.info.id] = parts
                }
                for (const message of removed) if (!visibleIDs.has(message.id)) delete draft.part[message.id]
                for (const [messageID, parts] of Object.entries(draft.part)) {
                  if (!visibleIDs.has(messageID) && parts.some((part) => part.sessionID === sessionID))
                    delete draft.part[messageID]
                }
                draft.message[sessionID] = visible
                if (!tracker.fields.has("diff") && diff.data) draft.session_diff[sessionID] = diff.data
              }),
            )
            touchSession(sessionID)
            fullSyncedSessions.add(sessionID)
          })()
            .catch((error) => {
              if (disposed || hydratingSessions.get(sessionID) !== tracker) return
              throw error
            })
            .finally(() => {
              if (hydratingSessions.get(sessionID) !== tracker) return
              syncingSessions.delete(sessionID)
              hydratingSessions.delete(sessionID)
            })
          syncingSessions.set(sessionID, task)
          return task
        },
      },
      bootstrap,
    }
    return result
  },
})

/** A mounted history consumer keeps its cache alive, including IDs supplied after tool startup. */
export function useSessionHistory(sessionID: () => string | undefined) {
  const sync = useSync()
  createEffect(() => {
    const id = sessionID()
    if (!id) return
    onCleanup(sync.session.retain(id))
    // Task detail is advisory; a failed read must not create an unhandled session error.
    void sync.session.sync(id).catch(() => {})
  })
}
