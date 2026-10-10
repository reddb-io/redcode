import type { SessionImportSourceInfo, SessionImportSummary } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { List } from "@opencode/ui/list"
import { Spinner } from "@opencode/ui/spinner"
import { Switch } from "@opencode/ui/switch"
import { showToast } from "@opencode/ui/toast"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { createLatest, type SetupContext } from "../sdk"
import type definition from "./index"
import { ago, existingSession, missingDirectory, shortFolder } from "./model"

type Context = SetupContext<typeof definition>

const LIST = "flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"

/**
 * Imports a session from another coding agent: pick a source the server reports, then one of its sessions. The
 * sources come from the server, so a source it adds appears here unchanged.
 */
export default function ImportDialog(props: {
  ctx: Context
  /** The server to import into, as `ServerRef.id`. */
  server: string
  /** The folder listed first; undefined lists every folder. */
  directory: string | undefined
  close: () => void
}) {
  const ctx = props.ctx
  // Read the ref each time: a restarted server gets a new client under the same id.
  const client = () => ctx.servers.get(props.server)?.client
  const sources = createLatest(client, (api, signal) => api.session.foreign.sources({ signal }))
  const [source, setSource] = createSignal<SessionImportSourceInfo>()

  return (
    <Dialog size="large">
      <Show
        when={source()}
        keyed
        fallback={
          <>
            <DialogHeader>
              <DialogTitleGroup title={ctx.t("sources.title")} description={ctx.t("sources.description")} />
            </DialogHeader>
            <DialogBody>
              <List
                class={LIST}
                emptyMessage={
                  !client()
                    ? ctx.t("server.unavailable")
                    : sources.error
                      ? errorText(sources.error)
                      : sources.latest
                        ? ctx.t("sources.empty")
                        : ctx.t("sources.loading")
                }
                key={(item) => item.source}
                // Available sources first, so the first one is the default pick.
                items={(sources.latest ?? []).toSorted((a, b) => Number(b.available) - Number(a.available))}
                onSelect={(item) => {
                  if (!item) return
                  if (!item.available)
                    return void showToast({ variant: "error", title: item.name, description: item.warning })
                  setSource(item)
                }}
              >
                {(item) => (
                  <div class="flex w-full min-w-0 flex-col gap-0.5 text-start" data-available={item.available}>
                    <div class="flex w-full items-center gap-2">
                      <span
                        class="min-w-0 flex-1 truncate text-14-medium"
                        classList={{
                          "text-v2-text-text-base": item.available,
                          "text-v2-text-text-faint": !item.available,
                        }}
                      >
                        {item.name}
                      </span>
                      <span class="shrink-0 text-12-regular text-v2-text-text-muted">
                        {item.available ? ctx.plural("sources.sessions", item.sessions) : ctx.t("sources.unavailable")}
                      </span>
                    </div>
                    <Show when={item.warning}>
                      {(warning) => <span class="text-12-regular text-v2-state-fg-warning">{warning()}</span>}
                    </Show>
                  </div>
                )}
              </List>
            </DialogBody>
          </>
        }
      >
        {(selected) => (
          <Sessions
            ctx={ctx}
            server={props.server}
            source={selected}
            directory={props.directory}
            back={() => setSource(undefined)}
            close={props.close}
          />
        )}
      </Show>
    </Dialog>
  )
}

function Sessions(props: {
  ctx: Context
  server: string
  source: SessionImportSourceInfo
  directory: string | undefined
  back: () => void
  close: () => void
}) {
  const ctx = props.ctx
  const client = () => ctx.servers.get(props.server)?.client
  const lifetime = new AbortController()
  const signal = AbortSignal.any([ctx.signal, lifetime.signal])
  onCleanup(() => lifetime.abort())
  const [all, setAll] = createSignal(props.directory === undefined)
  const [importing, setImporting] = createSignal<SessionImportSummary>()
  const [failure, setFailure] = createSignal<{ ref: string; message: string; relocate: boolean }>()
  // A new object only when the client or scope changes, so each change fetches once.
  const query = createMemo(() => {
    const api = client()

    return api ? { api, directory: all() ? undefined : props.directory } : undefined
  })
  const sessions = createLatest(query, (input, signal) =>
    input.api.session.foreign.list({ source: props.source.source, directory: input.directory, limit: 100 }, { signal }),
  )
  // While a scope loads, the previous scope's sessions are not this one's.
  const items = () => (sessions.loading ? [] : (sessions.latest ?? []))
  const name = props.source.name

  const scope = (next: boolean) => {
    setFailure(undefined)
    setAll(next)
  }

  const open = (sessionID: string, summary: SessionImportSummary, existing: boolean) => {
    const api = client()

    if (!api) return Promise.reject(new Error(ctx.t("server.unavailable")))
    return api.session.get({ sessionID }, { signal }).then((session) => {
      if (signal.aborted) return
      ctx.sessions.open(props.server, session)
      props.close()
      showToast({
        variant: "success",
        title: ctx.t(existing ? "toast.existing.title" : "toast.imported.title"),
        description: ctx.t(existing ? "toast.existing.description" : "toast.imported.description", {
          title: summary.title,
          name,
        }),
      })
    })
  }

  const run = (summary: SessionImportSummary) => {
    const api = client()

    if (importing()) return
    if (!api) {
      setFailure({ ref: summary.ref, message: ctx.t("server.unavailable"), relocate: false })
      return
    }
    const previous = failure()
    const relocate = previous?.ref === summary.ref && previous.relocate && props.directory !== undefined
    setFailure(undefined)
    setImporting(summary)
    void api.session.foreign
      .import(
        {
          source: summary.source,
          ref: summary.ref,
          location: relocate && props.directory ? { directory: props.directory } : undefined,
        },
        { signal },
      )
      .then(
        (result) => {
          if (signal.aborted) return
          ctx.sessions.open(props.server, result.session)
          props.close()
          showToast({
            variant: "success",
            title: ctx.t("toast.imported.title"),
            description:
              result.warnings.length > 0
                ? ctx.plural("toast.warnings", result.warnings.length, { title: summary.title, name })
                : ctx.t("toast.imported.description", { title: summary.title, name }),
          })
        },
        (cause: unknown) => {
          if (signal.aborted) return
          const existing = existingSession(cause)

          if (existing) return open(existing, summary, true)
          throw cause
        },
      )
      .catch((cause: unknown) => {
        if (signal.aborted) return
        setFailure({ ref: summary.ref, message: errorText(cause), relocate: missingDirectory(cause) })
      })
      .finally(() => {
        if (!signal.aborted) setImporting(undefined)
      })
  }

  return (
    <>
      <DialogHeader>
        <div class="flex min-w-0 items-center gap-2">
          <IconButton
            icon={<Icon name="arrow-left" />}
            variant="ghost"
            aria-label={ctx.t("sessions.back")}
            onClick={props.back}
          />
          <DialogTitleGroup
            title={ctx.t("sessions.title", { name })}
            description={all() || !props.directory ? undefined : props.directory}
          />
        </div>
      </DialogHeader>
      <DialogBody>
        <Show
          when={sessions.loading || items().length > 0}
          fallback={
            <div class="flex flex-col items-start gap-3 px-6 py-8">
              <span class="text-14-regular text-v2-text-text-muted">
                {!client()
                  ? ctx.t("server.unavailable")
                  : sessions.error
                    ? errorText(sessions.error)
                    : ctx.t(all() ? "sessions.empty.all" : "sessions.empty.folder", { name })}
              </span>
              <Show when={!all() && !sessions.error}>
                <Button variant="outline" size="small" onClick={() => scope(true)}>
                  {ctx.t("sessions.empty.showAll")}
                </Button>
              </Show>
            </div>
          }
        >
          <List
            class={LIST}
            search={{
              placeholder: ctx.t("sessions.search"),
              autofocus: true,
              action: (
                <Show when={props.directory}>
                  <Switch checked={all()} onChange={scope}>
                    {ctx.t("sessions.all")}
                  </Switch>
                </Show>
              ),
            }}
            emptyMessage={sessions.loading ? ctx.t("sessions.loading", { name }) : ctx.t("sessions.noMatch")}
            loadingMessage={ctx.t("sessions.loading", { name })}
            key={(item) => item.ref}
            items={items()}
            filterKeys={["title", "directory"]}
            onSelect={(item) => item && run(item)}
          >
            {(item) => (
              <div class="flex w-full min-w-0 flex-col gap-0.5 text-start" aria-busy={importing() === item}>
                <div class="flex w-full items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-14-medium text-v2-text-text-base">{item.title}</span>
                  <Show when={importing() === item}>
                    <Spinner class="size-4 shrink-0" />
                  </Show>
                  <span class="shrink-0 text-12-regular text-v2-text-text-muted">
                    {ago(item.time.updated, Date.now(), ctx.locale.locale())}
                  </span>
                </div>
                <span class="truncate text-12-regular text-v2-text-text-muted">
                  {[
                    ctx.plural(item.estimated ? "sessions.estimated" : "sessions.messages", item.messages),
                    ...(item.subagents > 0 ? [ctx.plural("sessions.subagents", item.subagents)] : []),
                    ...(item.model ? [item.model] : []),
                    shortFolder(item.directory),
                  ].join(" · ")}
                </span>
              </div>
            )}
          </List>
        </Show>
        <Show when={importing()}>
          {(summary) => (
            <div class="flex items-center gap-2 px-6 pb-4 text-13-regular text-v2-text-text-muted">
              <Spinner class="size-4" />
              <span class="truncate">{ctx.t("importing", { title: summary().title })}</span>
            </div>
          )}
        </Show>
        <Show when={!importing() && failure()}>
          {(value) => (
            <div class="flex flex-col items-start gap-2 px-6 pb-4">
              <span class="text-13-regular text-v2-state-fg-danger">{value().message}</span>
              <Show when={value().relocate && props.directory}>
                {(folder) => (
                  <Button
                    variant="outline"
                    size="small"
                    onClick={() => {
                      const summary = items().find((item) => item.ref === value().ref)

                      if (summary) run(summary)
                    }}
                  >
                    {ctx.t("relocate", { folder: shortFolder(folder()) })}
                  </Button>
                )}
              </Show>
            </div>
          )}
        </Show>
      </DialogBody>
    </>
  )
}

function errorText(cause: unknown) {
  return cause instanceof Error && cause.message ? cause.message : String(cause)
}
