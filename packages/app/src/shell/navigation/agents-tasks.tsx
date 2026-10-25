import type {
  SessionInfo,
  SessionTodoApplyIntegrationInput,
  WorktreeIntegrationCandidate,
} from "@opencode/client/promise"
import { useQuery } from "@tanstack/solid-query"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { uuid } from "@/runtime/persistence/uuid"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"
import { AgentTasksView } from "./agents-tasks.react"

export default function AgentTasks(props: { server: ServerConnection.Any; open: (session: SessionInfo) => void }) {
  const services = createAgentTaskServices(props)
  return <ReactView component={AgentTasksView} props={{ services }} />
}

export function createAgentTaskServices(props: { server: ServerConnection.Any; open: (session: SessionInfo) => void }) {
  const language = useLanguage()
  const context = useGlobal().ensureServerCtx(props.server)
  const api = context.sdk.api
  const host = ServerConnection.key(props.server)
  const connected = () => context.sdk.connection.status() === "connected"
  const lifetime = { active: true }
  onCleanup(() => (lifetime.active = false))
  const [state, setState] = createStore({
    sessionID: "",
    taskID: "",
    target: "",
    busy: false,
    error: "",
    review: undefined as
      | { sessionID: string; taskID: string; revision: number; candidate: WorktreeIntegrationCandidate }
      | undefined,
    request: undefined as SessionTodoApplyIntegrationInput | undefined,
  })
  const sessions = useQuery(() => ({
    queryKey: ["agent-task-sessions", host],
    enabled: connected(),
    queryFn: async ({ signal }) => {
      const items: SessionInfo[] = []
      let cursor: string | undefined
      for (;;) {
        const page = await api.session.list({ limit: 1000, order: "desc", cursor }, { signal })
        items.push(...page.data)
        if (!page.cursor.next) return items
        cursor = page.cursor.next
      }
    },
    retry: false,
    staleTime: 30_000,
  }))
  const session = () => sessions.data?.find((item) => item.id === state.sessionID)
  const tasks = useQuery(() => ({
    queryKey: ["agent-task-graph", host, state.sessionID],
    enabled: connected() && !!session(),
    queryFn: ({ signal }) => api.session.todo.graph({ sessionID: state.sessionID }, { signal }),
    retry: false,
    refetchInterval: 5000,
  }))
  const goal = useQuery(() => ({
    queryKey: ["agent-task-goal", host, state.sessionID],
    enabled: connected() && !!session(),
    queryFn: ({ signal }) => api.session.goal.get({ sessionID: state.sessionID }, { signal }),
    retry: false,
    refetchInterval: 5000,
  }))
  const task = () => tasks.data?.tasks.find((item) => item.id === state.taskID)
  const report = useQuery(() => ({
    queryKey: ["agent-task-reconciliation", host, state.sessionID, state.taskID, task()?.revision],
    enabled: connected() && !!task()?.id,
    queryFn: ({ signal }) =>
      api.session.todo.reconcile(
        { sessionID: state.sessionID, taskID: state.taskID, revision: task()?.revision },
        { signal },
      ),
    retry: false,
    refetchInterval: 5000,
  }))
  const inventory = useQuery(() => ({
    queryKey: ["agent-task-worktrees", host, session()?.projectID],
    enabled: connected() && !!session(),
    queryFn: ({ signal }) => api.worktree.list({ projectID: session()!.projectID }, { signal }),
    retry: false,
  }))
  const refresh = async () => {
    await sessions.refetch()
    if (!lifetime.active || !session()) return
    await Promise.all([tasks.refetch(), goal.refetch(), inventory.refetch()])
    if (lifetime.active && task()) await report.refetch()
  }
  const run = async (action: () => Promise<unknown>) => {
    if (state.busy || !connected()) return
    setState({ busy: true, error: "" })
    try {
      await action()
    } catch (error) {
      if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed")))
    } finally {
      if (lifetime.active) {
        await refresh()
        if (lifetime.active) setState("busy", false)
      }
    }
  }
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      connected: connected(),
      sessions: sessions.data ?? [],
      session: session(),
      sessionID: state.sessionID,
      tasks: tasks.data?.tasks ?? [],
      graph: tasks.data?.nodes ?? [],
      assignments: tasks.data?.assignments ?? [],
      context: tasks.data?.context,
      task: task(),
      taskID: state.taskID,
      goal: goal.data,
      goalError: goal.isError,
      report: report.isError ? undefined : report.data,
      loading: sessions.isLoading || tasks.isLoading || report.isLoading,
      unavailable: sessions.isError || tasks.isError || report.isError,
      sessionsError: sessions.isError,
      listUnavailable: sessions.isError || tasks.isError,
      refreshing: sessions.isFetching || tasks.isFetching || report.isFetching,
      targets: inventory.data ?? [],
      inventoryError: inventory.isError,
      target: state.target,
      busy: state.busy,
      error: state.error,
      review:
        state.review?.sessionID === state.sessionID && state.review.taskID === state.taskID ? state.review : undefined,
      request:
        state.request?.sessionID === state.sessionID && state.request.taskID === state.taskID
          ? state.request
          : undefined,
    })),
    selectSession: (sessionID: string) => {
      if (!state.busy) setState({ sessionID, taskID: "", target: "", review: undefined, error: "" })
    },
    selectTask: (taskID: string) => {
      if (!state.busy) setState({ taskID, review: undefined, error: "" })
    },
    selectTarget: (target: string) => {
      if (!state.busy) setState({ target, review: undefined, error: "" })
    },
    open: () => {
      const selected = session()
      if (selected) props.open(selected)
    },
    openAssignment: (sessionID: string) =>
      void run(async () => {
        const child = await api.session.get({ sessionID })
        if (lifetime.active) props.open(child)
      }),
    refresh: () => void run(async () => {}),
    prepare: () =>
      void run(async () => {
        const selected = task()
        const parent = session()
        if (!selected?.id || !selected.revision || !parent || !state.target) return
        const target = await api.worktreeLifecycle.inspect({
          projectID: parent.projectID,
          directory: state.target,
          target: state.target,
        })
        if (target.dirty || target.targetDirty) throw new Error(language.t("agentTasks.dirtyTarget"))
        const result = await api.session.todo.prepareIntegration({
          sessionID: parent.id,
          taskID: selected.id,
          revision: selected.revision,
          target: target.directory,
          targetHead: target.head,
        })
        if (lifetime.active)
          setState("review", {
            sessionID: parent.id,
            taskID: selected.id,
            revision: result.task.revision!,
            candidate: result.candidate,
          })
      }),
    review: () =>
      void run(async () => {
        const selected = report.data?.task
        const parent = session()
        const binding = selected?.integration
        if (!selected?.id || !selected.revision || !parent || !binding) return
        const candidate = await api.worktreeLifecycle.prepareIntegration({
          projectID: parent.projectID,
          target: binding.target,
          targetHead: binding.targetHead,
          sources: [
            ...new Map(
              binding.sources.map((item) => [item.directory, { directory: item.directory, head: item.head }]),
            ).values(),
          ],
        })
        if (candidate.status !== "ready" || candidate.head !== binding.head || candidate.tree !== binding.tree)
          throw new Error(language.t("agentTasks.changedCandidate"))
        if (lifetime.active)
          setState("review", { sessionID: parent.id, taskID: selected.id, revision: selected.revision, candidate })
      }),
    apply: () =>
      void run(async () => {
        const selected = report.data?.task
        const review = state.review
        if (
          !selected?.id ||
          !selected.revision ||
          !review ||
          review.revision !== selected.revision ||
          !review.candidate.head
        )
          return
        const pending =
          selected.integrationApplication?.state === "pending" ? selected.integrationApplication : undefined
        // Retain the original identity after a lost response; retrying it observes an admitted operation.
        const request =
          state.request?.sessionID === state.sessionID && state.request.taskID === selected.id
            ? state.request
            : {
                sessionID: state.sessionID,
                taskID: selected.id,
                requestID: pending?.requestID ?? uuid(),
                revision: pending?.taskRevision ?? selected.revision,
                candidateHead: pending?.head ?? review.candidate.head,
              }
        setState("request", request)
        const result = await api.session.todo.applyIntegration(request)
        if (lifetime.active && result.state === "applied") setState("request", undefined)
      }),
    retry: () =>
      void run(async () => {
        const receipt = task()?.integrationApplication
        const pending = receipt?.state === "pending" ? receipt : undefined
        const request =
          state.request?.sessionID === state.sessionID && state.request.taskID === state.taskID
            ? state.request
            : pending && {
                sessionID: state.sessionID,
                taskID: state.taskID,
                requestID: pending.requestID,
                revision: pending.taskRevision,
                candidateHead: pending.head,
              }
        if (!request) return
        const result = await api.session.todo.applyIntegration(request)
        if (lifetime.active && result.state === "applied") setState("request", undefined)
      }),
  }
}
