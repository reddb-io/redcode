import type {
  AttentionEntry,
  FormAnswer,
  FormInfo,
  PermissionReply,
  PermissionRequest,
  WorkerBatch,
  WorkersAnswerInput,
} from "@opencode/client/promise"
import { card } from "@reddb-io/design-system/contracts/card"
import { navItem } from "@reddb-io/design-system/contracts/nav-item"
import { Button } from "@opencode/ui/button"
import { useQuery } from "@tanstack/solid-query"
import { Key } from "@solid-primitives/keyed"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerProvider } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"
import { SessionQuestionDock } from "@/session/requests/session-question-dock"
import { sessionLabel } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { errorMessage } from "@/shell/layout/helpers"
import { useNavigation } from "./controller"

type Request = { key: string; permission?: PermissionRequest; form?: FormInfo; entry: AttentionEntry }
type Selection = { get: () => string; set: (key: string) => void }

export default function AgentInbox(props: { server: ServerConnection.Any; selection: Selection }) {
  const global = useGlobal()
  const navigation = useNavigation()
  const language = useLanguage()
  const ctx = () => global.ensureServerCtx(props.server)
  const connected = () => ctx().sdk.connection.status() === "connected"
  const local = useQuery(() => ({
    queryKey: ["agents-attention", ServerConnection.key(props.server)],
    enabled: connected(),
    queryFn: ({ signal }) => ctx().sdk.api.server.attention({ signal }),
    retry: false,
    refetchInterval: 5000,
  }))
  const workers = useQuery(() => ({
    queryKey: ["remote-workers", ServerConnection.key(props.server)],
    enabled: connected(),
    queryFn: ({ signal }) => ctx().sdk.api.workers.list({ signal }),
    retry: false,
    refetchInterval: 5000,
  }))
  return (
    <ServerProvider conn={props.server}>
      <div class="flex flex-col gap-5">
        <h3 class="text-13-medium">{language.t("agents.inbox.local")}</h3>
        <Show when={local.isError || !connected()}>
          <p role="alert">{language.t("agents.inbox.unavailable")}</p>
        </Show>
        <Show when={local.data?.unavailable.length}>
          <p role="alert">{language.t("agents.inbox.partial")}</p>
        </Show>
        <Show when={local.isPending && connected()}>
          <p role="status">{language.t("agents.loading")}</p>
        </Show>
        <Requests
          selection={props.selection}
          entries={local.data?.data ?? []}
          ready={connected() && !local.isError && !local.isPending}
          complete={!local.data?.unavailable.length}
          scope={ServerConnection.key(props.server)}
          open={(entry) => navigation.session.open(entry.session, { server: props.server })}
          answer={async (request, decision, answer, cancel) => {
            if (request.permission && decision)
              await ctx().sdk.api.permission.reply({
                sessionID: request.entry.session.id,
                requestID: request.permission.id,
                decision,
              })
            if (request.form && cancel)
              await ctx().sdk.api.session.form.cancel({ sessionID: request.entry.session.id, formID: request.form.id })
            if (request.form && answer)
              await ctx().sdk.api.session.form.reply({
                sessionID: request.entry.session.id,
                formID: request.form.id,
                answer,
              })
            await local.refetch()
          }}
        />
        <h3 class="text-13-medium">{language.t("remoteWorkers.title")}</h3>
        <Show when={workers.isError || !connected()}>
          <p role="alert">{language.t("agents.inbox.unavailable")}</p>
        </Show>
        <Key
          each={workers.data?.batches.filter((batch) =>
            batch.report?.tasks.some((task) => !["succeeded", "failed", "interrupted"].includes(task.state)),
          )}
          by={(batch) => batch.id}
        >
          {(batch) => (
            <BatchInbox
              selection={props.selection}
              server={props.server}
              batch={batch()}
              connected={connected() && !workers.isError}
            />
          )}
        </Key>
        <Button
          variant="outline"
          disabled={!connected() || local.isFetching || workers.isFetching}
          onClick={() => {
            void local.refetch()
            void workers.refetch()
          }}
        >
          {language.t("agents.inbox.refresh")}
        </Button>
      </div>
    </ServerProvider>
  )
}

function BatchInbox(props: {
  server: ServerConnection.Any
  batch: WorkerBatch
  connected: boolean
  selection: Selection
}) {
  const global = useGlobal()
  const language = useLanguage()
  const api = () => global.ensureServerCtx(props.server).sdk.api.workers
  const query = useQuery(() => ({
    queryKey: ["worker-attention", ServerConnection.key(props.server), props.batch.id],
    enabled: props.connected,
    queryFn: ({ signal }) => api().attention({ id: props.batch.id }, { signal }),
    retry: false,
    refetchInterval: 5000,
  }))
  return (
    <section aria-label={props.batch.id} class="flex flex-col gap-3">
      <h4 class="text-13-medium">{props.batch.id}</h4>
      <Show when={query.isError || !props.connected}>
        <p role="alert">{language.t("agents.inbox.unavailable")}</p>
      </Show>
      <Show when={query.data?.unavailable.length}>
        <p role="alert">{language.t("agents.inbox.partial")}</p>
      </Show>
      <Key each={query.data?.data} by={(pending) => pending.task.id}>
        {(item) => {
          const pending = () => item()
          return (
            <div class="flex flex-col gap-2">
              <p class="text-13-regular text-ink-muted">
                {language.t("agents.inbox.assignment", {
                  task: pending().task.id,
                  worker: pending().task.worker ?? "",
                })}
              </p>
              <Requests
                selection={props.selection}
                entries={[pending().attention]}
                ready={props.connected && !query.isError}
                scope={`${ServerConnection.key(props.server)}:${props.batch.id}:${pending().task.id}`}
                answer={async (request, decision, answer, cancel) => {
                  const payload: WorkersAnswerInput["payload"] =
                    request.permission && decision
                      ? { kind: "permission", task: pending().task.id, requestID: request.permission.id, decision }
                      : cancel && request.form
                        ? { kind: "cancel", task: pending().task.id, formID: request.form.id }
                        : { kind: "question", task: pending().task.id, formID: request.form!.id, answer: answer! }
                  await api().answer({ id: props.batch.id, payload })
                  await query.refetch()
                }}
              />
            </div>
          )
        }}
      </Key>
      <Button variant="outline" disabled={!props.connected || query.isFetching} onClick={() => void query.refetch()}>
        {language.t("agents.inbox.refreshWorker")}
      </Button>
    </section>
  )
}

function Requests(props: {
  selection: Selection
  entries: AttentionEntry[]
  ready: boolean
  complete?: boolean
  scope: string
  open?: (entry: AttentionEntry) => void
  answer: (request: Request, decision?: PermissionReply, answer?: FormAnswer, cancel?: boolean) => Promise<void>
}) {
  const language = useLanguage()
  const appearance = card({ padding: "md" })
  const [state, setState] = createStore({ busy: false })
  const requests = createMemo<Request[]>(() =>
    props.entries.flatMap((entry) => [
      ...entry.permissions.map((permission) => ({ key: `${entry.session.id}:${permission.id}`, permission, entry })),
      ...entry.forms.map((form) => ({ key: `${entry.session.id}:${form.id}`, form, entry })),
    ]),
  )
  // A changed or answered request never implicitly selects the next approval.
  const selected = createMemo(
    () => requests().find((request) => `${props.scope}:${request.key}` === props.selection.get()),
    undefined,
    { equals: (previous, next) => previous?.key === next?.key },
  )
  const run = async (request: Request, decision?: PermissionReply, answer?: FormAnswer, cancel?: boolean) => {
    if (!props.ready || state.busy) return
    setState("busy", true)
    try {
      await props.answer(request, decision, answer, cancel)
    } finally {
      setState("busy", false)
    }
  }
  return (
    <div class="flex min-w-0 flex-col gap-3">
      <Show when={props.ready && props.complete !== false && requests().length === 0}>
        <p role="status">{language.t("agents.inbox.empty")}</p>
      </Show>
      <For each={requests()}>
        {(request) => (
          <button
            type="button"
            aria-pressed={props.selection.get() === `${props.scope}:${request.key}`}
            disabled={state.busy}
            class={navItem({ current: props.selection.get() === `${props.scope}:${request.key}` }).root({
              class: "text-start",
            })}
            onClick={() => props.selection.set(`${props.scope}:${request.key}`)}
          >
            <span class="min-w-0 flex-1 truncate">
              {sessionLabel(request.entry.session)} · {request.permission?.action ?? request.form?.title}
            </span>
            <span class="text-caption text-ink-muted">
              {language.t(request.permission ? "notification.permission.title" : "agents.inbox.question")}
            </span>
          </button>
        )}
      </For>
      <Show when={selected()} keyed>
        {(request) => (
          <div class={appearance.root()}>
            <div class={appearance.body({ class: "min-w-0" })}>
              <Show when={request.permission} keyed>
                {(permission) => (
                  <SessionPermissionDock
                    request={permission}
                    responding={state.busy || !props.ready}
                    onDecide={(decision) => {
                      void run(request, decision).catch((error) =>
                        showToast({
                          title: language.t("common.requestFailed"),
                          description: errorMessage(error, language.t("common.requestFailed")),
                        }),
                      )
                    }}
                  />
                )}
              </Show>
              <Show when={request.form} keyed>
                {(form) => (
                  <Show
                    when={form.metadata?.kind === "question"}
                    fallback={<p>{language.t("agents.inbox.openRequired")}</p>}
                  >
                    <SessionQuestionDock
                      request={form}
                      cacheScope={props.scope}
                      disabled={!props.ready}
                      onSubmit={() => undefined}
                      onReply={(answer) => run(request, undefined, answer)}
                      onCancel={() => run(request, undefined, undefined, true)}
                    />
                  </Show>
                )}
              </Show>
              <Show when={props.open}>
                <Button variant="ghost" onClick={() => props.open?.(request.entry)}>
                  {language.t("agents.inbox.open")}
                </Button>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
