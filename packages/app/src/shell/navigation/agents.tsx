import type { SessionInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { input } from "@reddb-io/design-system/contracts/input"
import { useQuery } from "@tanstack/solid-query"
import { createMemo, For, lazy, onCleanup, Show, Switch, Match } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { useSettings } from "@/settings/model"
import { isSessionForm } from "@/session/requests/session-request-tree"
import { sessionLabel } from "@/session/title"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { useNavigation } from "./controller"
import { AGENT_LABELS, useAgentsScope } from "./agents-menu"
import { agentSessionTrees, SESSION_STATUSES, rollupSessionStatus, sessionAwaitsUser, sessionStatus } from "./model"
import { AgentWorkers } from "./workers"
import { RemoteWorkers } from "./remote-workers"

const AgentInbox = lazy(() => import("./agents-inbox"))
const AgentHosts = lazy(() => import("./agents-hosts"))
const AgentHarnesses = lazy(() => import("./agents-harnesses"))
const AgentMachines = lazy(() => import("./agents-machines"))
const AgentEnvironments = lazy(() => import("./agents-environments"))
const AgentWorktrees = lazy(() => import("./agents-worktrees"))

type AgentInstruction = {
  sessionID: string
  orienting: boolean
  text: string
  delivery: "steer" | "queue"
  busy: boolean
}

/** A metadata-only fleet view; transcripts load only when the user opens a session. */
export default function Agents() {
  const language = useLanguage()
  const global = useGlobal()
  const navigation = useNavigation()
  const scope = useAgentsScope()
  const [state, setState] = createStore({ query: "", attention: false, selected: "" })
  const selection = { get: () => state.selected, set: (key: string) => setState("selected", key) }
  return (
    <section
      aria-label={language.t("agents.title")}
      data-component="agents-workspace"
      class="flex h-full min-h-0 w-full flex-col px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]"
    >
      <div class="flex min-h-0 flex-1 flex-col rounded-lg border border-v2-border-border-base bg-v2-background-bg-base">
        <header class="flex flex-wrap items-center gap-2 border-b border-v2-border-border-base px-5 py-4">
          <div class="min-w-0 flex-1">
            <h1 class="text-16-medium">{language.t(AGENT_LABELS[scope.view()])}</h1>
            <p class="text-13-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
              {language.t("agents.description")}
            </p>
          </div>
          <Button variant="outline" onClick={navigation.go.newSession}>
            {language.t("command.session.new")}
          </Button>
          <Show when={scope.view() === "sessions"}>
            <input
              class={input({ size: "sm", class: "w-full sm:w-48" })}
              aria-label={language.t("agents.filter")}
              placeholder={language.t("agents.filter")}
              value={state.query}
              onInput={(event) => setState("query", event.currentTarget.value)}
            />
            <Button
              variant="ghost"
              aria-pressed={state.attention}
              onClick={() => setState("attention", !state.attention)}
            >
              {language.t("agents.attention")}
            </Button>
          </Show>
        </header>
        <div class="min-h-0 w-full flex-1 overflow-y-auto px-5 py-3">
          <Show when={scope.servers().length === 0}>
            <p role="status">{language.t("agents.scope.missing")}</p>
          </Show>
          <Show when={scope.view() === "machines" && scope.servers()[0]}>
            {(server) => (
              <section class="mb-5">
                <h2 class="mb-2 text-13-medium text-v2-text-text-muted">{serverName(server())}</h2>
                <Show
                  when={!global.servers.health[ServerConnection.key(server())]?.unauthorized}
                  fallback={<p role="alert">{language.t("agents.unavailable")}</p>}
                >
                  <AgentMachines server={server()} />
                </Show>
              </section>
            )}
          </Show>
          <For each={scope.view() === "machines" ? [] : scope.servers()}>
            {(server) => (
              <section class="mb-5">
                <h2 class="mb-2 text-13-medium text-v2-text-text-muted">{serverName(server)}</h2>
                <Show
                  when={!global.servers.health[ServerConnection.key(server)]?.unauthorized}
                  fallback={<p role="alert">{language.t("agents.unavailable")}</p>}
                >
                  <Switch>
                    <Match when={scope.view() === "sessions"}>
                      <ServerAgents
                        server={server}
                        context={global.ensureServerCtx(server)}
                        query={state.query}
                        attention={state.attention}
                        open={(session) => {
                          navigation.session.open(session, { server })
                        }}
                      />
                    </Match>
                    <Match when={scope.view() === "inbox"}>
                      <AgentInbox server={server} selection={selection} />
                    </Match>
                    <Match when={scope.view() === "hosts"}>
                      <AgentHosts server={server} />
                    </Match>
                    <Match when={scope.view() === "harness"}>
                      <AgentHarnesses server={server} />
                    </Match>
                    <Match when={scope.view() === "environments"}>
                      <AgentEnvironments server={server} />
                    </Match>
                    <Match when={scope.view() === "worktrees"}>
                      <AgentWorktrees server={server} />
                    </Match>
                    <Match when={scope.view() === "remote"}>
                      <RemoteWorkers server={server} />
                    </Match>
                    <Match when={scope.view() === "workers"}>
                      <AgentWorkers server={server} />
                    </Match>
                  </Switch>
                </Show>
              </section>
            )}
          </For>
        </div>
      </div>
    </section>
  )
}

function ServerAgents(props: {
  server: ServerConnection.Any
  context: ServerCtx
  query: string
  attention: boolean
  open: (session: SessionInfo) => void
}) {
  const language = useLanguage()
  const settings = useSettings()
  const [instruction, setInstruction] = createStore<AgentInstruction>({
    sessionID: "",
    orienting: false,
    text: "",
    delivery: "steer",
    busy: false,
  })
  const lifetime = { active: true }
  onCleanup(() => (lifetime.active = false))
  // Own pending controls with the draft: moving a family between status groups remounts its rows.
  const run = (sessionID: string, request: () => Promise<unknown>, reset = false) => {
    if (instruction.busy) return
    setInstruction("busy", true)
    void request()
      .then(() => {
        if (lifetime.active && reset && instruction.sessionID === sessionID)
          setInstruction({ orienting: false, text: "" })
      })
      .catch((error) => {
        if (!lifetime.active) return
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(error, language.t("common.requestFailed")),
        })
      })
      .finally(() => {
        if (lifetime.active) setInstruction("busy", false)
      })
  }
  const query = useQuery(() => ({
    queryKey: ["agents-sessions", ServerConnection.key(props.server)],
    enabled: props.context.sdk.connection.status() === "connected",
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const sessions: SessionInfo[] = []
      let cursor: string | undefined
      for (;;) {
        const page = await props.context.sdk.api.session.list({ limit: 1000, order: "desc", cursor }, { signal })
        sessions.push(...page.data)
        if (!page.cursor.next) return sessions
        cursor = page.cursor.next
      }
    },
    retry: false,
    staleTime: 30000,
  }))
  const sessions = createMemo(() =>
    props.context.data.session
      .apply([
        ...new Map(
          [...(query.data ?? []), ...props.context.data.session.list()].map((item) => [item.id, item]),
        ).values(),
      ])
      .filter((item) => !item.time.archived),
  )
  const status = (session: SessionInfo) =>
    sessionStatus({
      approval:
        props.context.data.session.permission
          .list(session.id)
          ?.some((request) => !settings.permissions.autoApprove() || request.metadata?.protected !== undefined) ??
        false,
      input: props.context.data.session.form.list(session.id)?.some(isSessionForm) ?? false,
      working: props.context.data.session.status(session.id) === "running",
      queued: props.context.data.session.pending.list(session.id).some((item) => item.type !== "synthetic"),
      failed: props.context.notification.session.all(session.id).at(-1)?.type === "error",
      done: props.context.notification.session.unseenCount(session.id) > 0,
    })
  const trees = createMemo(() =>
    agentSessionTrees(sessions()).map((tree) => ({
      ...tree,
      status: rollupSessionStatus(tree.rows.map((row) => status(row.session))),
    })),
  )
  const groups = createMemo(() =>
    [...SESSION_STATUSES, undefined].flatMap((group) => {
      const list = trees().filter(
        (tree) =>
          tree.status === group &&
          (!props.attention || sessionAwaitsUser(group)) &&
          tree.rows.some(({ session: item }) =>
            `${sessionLabel(item)} ${item.location.directory} ${item.agent ?? ""}`
              .toLowerCase()
              .includes(props.query.toLowerCase()),
          ),
      )
      return list.length ? [{ status: group, list }] : []
    }),
  )
  return (
    <>
      <Show when={query.isFetching && query.isPending}>
        <p role="status">{language.t("common.loading")}</p>
      </Show>
      <Show when={props.context.sdk.connection.status() !== "connected"}>
        <p role="status" class="text-13-regular text-v2-text-text-muted">
          {language.t("agents.reconnecting")}
        </p>
      </Show>
      <Show when={query.isError}>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {language.t("common.retry")}
        </Button>
        <p role="alert">{errorMessage(query.error, language.t("common.requestFailed"))}</p>
      </Show>
      <Show when={!query.isPending && !groups().length}>
        <p class="text-13-regular text-v2-text-text-muted">{language.t("agents.empty")}</p>
      </Show>
      <For each={groups().map((group) => group.status ?? "idle")}>
        {(groupID) => {
          const group = () => groups().find((item) => (item.status ?? "idle") === groupID)
          return (
            <section class="mb-4">
              <h3 class="mb-2 text-12-medium text-v2-text-text-muted">
                {groupID === "idle" ? language.t("agents.idle") : language.t(`navigation.status.${groupID}`)}
              </h3>
              <For each={group()?.list.map((tree) => tree.root.id) ?? []}>
                {(rootID) => {
                  const tree = () => group()?.list.find((item) => item.root.id === rootID)
                  const root = () => tree()?.root
                  return (
                    <div class="mb-2 rounded-lg border border-v2-border-border-base">
                      <div
                        class="truncate border-b border-v2-border-border-base px-3 py-1 text-12-regular text-v2-text-text-muted"
                        title={root()?.location.directory}
                      >
                        <Show when={root()}>
                          {(session) =>
                            props.context.projects.forSession(session())?.name ??
                            props.context.projects.forSession(session())?.worktree ??
                            session().location.directory
                          }
                        </Show>
                      </div>
                      <For each={tree()?.rows.map((row) => row.session.id) ?? []}>
                        {(sessionID) => {
                          const row = () => tree()?.rows.find((item) => item.session.id === sessionID)
                          return (
                            <Show when={row()}>
                              {(entry) => (
                                <AgentSession
                                  session={entry().session}
                                  context={props.context}
                                  instruction={instruction}
                                  setInstruction={setInstruction}
                                  run={(request, reset) => run(entry().session.id, request, reset)}
                                  depth={entry().depth}
                                  status={status(entry().session)}
                                  open={() => props.open(entry().session)}
                                />
                              )}
                            </Show>
                          )
                        }}
                      </For>
                    </div>
                  )
                }}
              </For>
            </section>
          )
        }}
      </For>
    </>
  )
}

function AgentSession(props: {
  session: SessionInfo
  context: ServerCtx
  depth: number
  instruction: AgentInstruction
  setInstruction: SetStoreFunction<AgentInstruction>
  run: (request: () => Promise<unknown>, reset?: boolean) => void
  status: ReturnType<typeof sessionStatus>
  open: () => void
}) {
  const language = useLanguage()
  const state = props.instruction
  const setState = props.setInstruction
  return (
    <div
      class="border-b border-v2-border-border-base px-3 py-2 last:border-b-0"
      style={{ "padding-inline-start": `${12 + props.depth * 16}px` }}
    >
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="min-w-0 flex-1 text-start" onClick={props.open}>
          <span class="block truncate text-13-medium">{sessionLabel(props.session)}</span>
          <span class="block truncate text-12-regular text-v2-text-text-muted">
            {props.session.agent} · {props.session.location.directory}
          </span>
        </button>
        <Show when={props.status}>
          {(status) => (
            <span class="text-12-regular text-v2-text-text-muted">{language.t(`navigation.status.${status()}`)}</span>
          )}
        </Show>
        <Button
          size="small"
          variant="ghost"
          disabled={state.busy}
          onClick={() =>
            setState({
              sessionID: props.session.id,
              orienting: state.sessionID !== props.session.id || !state.orienting,
              text: state.sessionID === props.session.id ? state.text : "",
            })
          }
        >
          {language.t("agents.orient")}
        </Button>
        <Show when={props.status === "working"}>
          <Button
            size="small"
            variant="outline"
            disabled={state.busy}
            onClick={() => props.run(() => props.context.sdk.api.session.interrupt({ sessionID: props.session.id }))}
          >
            {language.t("agents.interrupt")}
          </Button>
        </Show>
      </div>
      <Show when={state.orienting && state.sessionID === props.session.id}>
        <form
          class="mt-2 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (state.text.trim())
              props.run(
                () =>
                  props.context.sdk.api.session.prompt({
                    sessionID: props.session.id,
                    text: state.text,
                    delivery: state.delivery,
                  }),
                true,
              )
          }}
        >
          <textarea
            class="w-full rounded-md border border-v2-border-border-base bg-transparent p-2 text-13-regular"
            aria-label={language.t("agents.instruction")}
            placeholder={language.t("agents.instruction")}
            value={state.text}
            disabled={state.busy}
            onInput={(event) => setState("text", event.currentTarget.value)}
          />
          <select
            aria-label={language.t("agents.delivery")}
            value={state.delivery}
            disabled={state.busy}
            onChange={(event) => setState("delivery", event.currentTarget.value === "queue" ? "queue" : "steer")}
          >
            <option value="steer">{language.t("agents.steer")}</option>
            <option value="queue">{language.t("agents.queue")}</option>
          </select>
          <Button type="submit" size="small" disabled={state.busy || !state.text.trim()}>
            {language.t("agents.send")}
          </Button>
        </form>
      </Show>
    </div>
  )
}
