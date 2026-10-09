import { createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { DesignInfo } from "@opencode/client/promise"
import { Design } from "@opencode/schema/design"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import { useExtension, type MountedSession } from "../sdk"
import type definition from "./index"
import type { DesignReviewOpener } from "./model"
import { designActivity, designReview, designStatus } from "./state"

/** The Design tab: the session's designs with their review state, and the way into the browser review. */
export default function SessionDesignPanel(props: { session: MountedSession; openReview: DesignReviewOpener }) {
  const ctx = useExtension<typeof definition>()
  const dialogs = ctx.dialogs
  const client = () => props.session.server.client
  /** Changes whenever the session's designs may have changed, so the tab reads them again. */
  const activity = createMemo(() => designActivity(props.session.server.data.session.message.list(props.session.id)))
  // The design whose approval or reopening is in flight; one action at a time, like the review page.
  const [store, setStore] = createStore({ opening: false, pending: "" })
  const [designs, { refetch }] = createResource(
    () => (props.session.id ? { sessionID: props.session.id, activity: activity() } : undefined),
    (input) => client().session.design.list({ sessionID: input.sessionID }),
  )
  // Reading an unresolved resource would suspend the whole side panel, so only settled values are read.
  const list = () => (designs.state === "ready" || designs.state === "refreshing" ? designs.latest : undefined)
  const openReview = () => {
    const sessionID = props.session.id
    if (!sessionID || store.opening) return
    setStore("opening", true)
    void props
      .openReview(sessionID, { url: props.session.server.url, password: props.session.server.password })
      .finally(() => setStore("opening", false))
  }
  // Approval freezes the current revision and hands the session to Plan; reopening lets the review take notes again.
  const act = (design: DesignInfo, action: "approve" | "reopen") => {
    const sessionID = props.session.id
    if (!sessionID || store.pending) return
    setStore("pending", design.id)
    // Annotated so the two branches' different results share one continuation.
    const request: Promise<unknown> =
      action === "approve"
        ? client()
            .session.design.approve({ sessionID, designID: design.id, revision: design.revision ?? "" })
            .then((result) =>
              showToast({
                variant: "success",
                title: ctx.t(result.agent === "plan" ? "approve.done.plan" : "approve.done"),
              }),
            )
        : client().session.design.reopen({ sessionID, designID: design.id })
    void request
      .catch((error) =>
        showToast({
          variant: "error",
          title: ctx.t(action === "approve" ? "approve.failed" : "reopen.failed"),
          description: error instanceof Error && error.message ? error.message : ctx.t("common.requestFailed"),
        }),
      )
      .finally(() => {
        setStore("pending", "")
        void refetch()
      })
  }

  function ApproveDialog(dialogProps: { design: DesignInfo; close: () => void }) {
    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={ctx.t("approve.title")}
            description={ctx.t("approve.confirm", {
              name: dialogProps.design.name,
              revision: dialogProps.design.revision ?? "",
            })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialogProps.close()}>
            {ctx.t("common.cancel")}
          </Button>
          <Button
            variant="submit"
            onClick={() => {
              dialogProps.close()
              act(dialogProps.design, "approve")
            }}
          >
            {ctx.t("approve")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-design-panel">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-v2-border-border-base px-5 py-3">
        <div class="min-w-0 truncate text-13-medium text-v2-text-text-base">{ctx.t("title")}</div>
        <div class="flex shrink-0 items-center gap-2">
          <Tooltip value={ctx.t("refresh")}>
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="refresh" />}
              aria-label={ctx.t("refresh")}
              disabled={designs.loading}
              onClick={() => void refetch()}
            />
          </Tooltip>
          <Button size="small" variant="outline" disabled={store.opening || !list()?.length} onClick={openReview}>
            {ctx.t("review.open")}
          </Button>
        </div>
      </div>

      <div class="relative min-h-0 flex-1">
        <Switch>
          <Match when={designs.error}>
            <div class="flex h-full flex-col items-center justify-center gap-3 px-8 pb-24 text-center">
              <div class="text-13-regular text-text-weak">{ctx.t("error")}</div>
              <Button size="small" variant="outline" onClick={() => void refetch()}>
                {ctx.t("common.retry")}
              </Button>
            </div>
          </Match>
          <Match when={list() === undefined}>
            <div class="px-5 py-4 text-13-regular text-text-weak" role="status">
              {ctx.t("loading")}
            </div>
          </Match>
          <Match when={list()?.length === 0}>
            <div class="flex h-full items-center justify-center px-8 pb-24 text-center text-13-regular text-text-weak">
              {ctx.t("empty")}
            </div>
          </Match>
          <Match when={list()}>
            {(items) => (
              <ScrollView class="absolute inset-0">
                <ul class="flex flex-col pb-8">
                  <For each={items()}>
                    {(design) => (
                      <SessionDesignRow
                        session={props.session}
                        design={design}
                        pending={store.pending === design.id}
                        busy={store.pending !== ""}
                        onApprove={() =>
                          dialogs.open((handle) => <ApproveDialog design={design} close={() => handle.close()} />)
                        }
                        onReopen={() => act(design, "reopen")}
                      />
                    )}
                  </For>
                </ul>
              </ScrollView>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}

const statusLabels = {
  draft: "status.draft",
  review: "status.review",
  approved: "status.approved",
  closed: "status.closed",
} as const

// The notes of the newest round the row lists; the review page lists them all.
const ROUND_NOTES = 5

const noteLabels = {
  open: "note.open",
  resolved: "note.resolved",
  partial: "note.partial",
  unresolved: "note.unresolved",
  accepted: "note.accepted",
} as const

function SessionDesignRow(props: {
  session: MountedSession
  design: DesignInfo
  pending: boolean
  busy: boolean
  onApprove: () => void
  onReopen: () => void
}) {
  const ctx = useExtension<typeof definition>()
  const status = () => designStatus(props.design)
  // A revision's number (R7) is its position in the revision list, read again only when a new revision is published.
  const [revisions] = createResource(
    () => (props.session.id && props.design.revision ? `${props.design.id}:${props.design.revision}` : undefined),
    () =>
      props.session.server.client.session.design
        .revisions({ sessionID: props.session.id, designID: props.design.id })
        .then((list) => list.map((revision) => ({ id: revision.id })))
        .catch(() => []),
  )
  const review = createMemo(() =>
    designReview(
      props.design,
      revisions.state === "ready" || revisions.state === "refreshing" ? revisions.latest : undefined,
    ),
  )
  const name = (revision: { id: string; ordinal: number }) =>
    revision.ordinal ? ctx.t("revision.ordinal", { ordinal: revision.ordinal }) : revision.id
  const tally = () => {
    const round = review().round
    if (!round) return ""
    return (["open", "resolved", "partial", "unresolved", "accepted"] as const)
      .filter((key) => round[key] > 0)
      .map((key) => ctx.plural(`round.${key}`, round[key]))
      .join(" · ")
  }
  const target = () => {
    if (props.design.target === "app")
      return props.design.platform === "android"
        ? ctx.t("target.android")
        : props.design.platform === "ios"
          ? ctx.t("target.ios")
          : ctx.t("target.app")
    if (props.design.target === "presentation") return ctx.t("target.presentation")
    if (props.design.target === "web") return ctx.t("target.web")
  }
  return (
    <li
      data-slot="session-design-row"
      data-status={status()}
      class="flex min-w-0 flex-col gap-1 border-b border-v2-border-border-base px-5 py-3"
    >
      <div class="flex min-w-0 items-center justify-between gap-3">
        <bdi dir="auto" class="min-w-0 truncate text-13-medium text-v2-text-text-base">
          {props.design.name}
        </bdi>
        <span
          class="shrink-0 text-12-medium"
          classList={{
            "text-v2-text-text-accent": status() === "approved",
            "text-v2-text-text-muted": status() !== "approved",
          }}
        >
          {ctx.t(statusLabels[status()])}
        </span>
      </div>
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 text-12-regular text-v2-text-text-muted">
        <Show when={target()}>{(value) => <span>{value()}</span>}</Show>
        <Show when={review().summary.revision}>
          {(revision) => (
            <span class="truncate" title={revision().id}>
              {ctx.t("revision", { revision: name(revision()) })}
            </span>
          )}
        </Show>
        <Show when={props.design.approvedRevision && props.design.approvedRevision !== props.design.revision}>
          <span class="truncate">
            {ctx.t("approvedRevision", { revision: props.design.approvedRevision ?? "" })}
          </span>
        </Show>
      </div>
      <Show when={review().round}>
        {(round) => (
          <div class="flex min-w-0 flex-col gap-1 pt-1" data-slot="session-design-round">
            <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-12-regular text-v2-text-text-muted">
              <span class="shrink-0 text-12-medium text-v2-text-text-base">
                {ctx.t("round", { round: round().number })}
              </span>
              <span>{tally()}</span>
              <Show when={review().summary.endRequested}>
                <span class="text-v2-text-text-accent">{ctx.t("round.ending")}</span>
              </Show>
            </div>
            <ul class="flex min-w-0 flex-col gap-0.5 text-12-regular">
              <For each={review().notes.slice(0, ROUND_NOTES)}>
                {(note) => (
                  <li class="flex min-w-0 items-baseline gap-2" data-status={note.status}>
                    <span
                      class="w-20 shrink-0 truncate"
                      classList={{
                        "text-v2-state-fg-success": note.status === "resolved",
                        "text-v2-state-fg-warning": note.status === "partial",
                        "text-v2-state-fg-danger": note.status === "unresolved",
                        "text-v2-text-text-muted": note.status === "open" || note.status === "accepted",
                      }}
                    >
                      {ctx.t(noteLabels[note.status])}
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <bdi dir="auto" class="min-w-0 truncate text-v2-text-text-base">
                        {note.item.text.trim() || note.item.label || note.item.target}
                      </bdi>
                      {/* Why a note was not fixed, or kept: one line, the whole reason on hover. */}
                      <Show when={note.status !== "open" && note.status !== "resolved" && note.reason?.trim()}>
                        {(reason) => (
                          <bdi
                            dir="auto"
                            class="min-w-0 truncate text-v2-text-text-muted"
                            title={reason()}
                            data-slot="session-design-note-reason"
                          >
                            {reason()}
                          </bdi>
                        )}
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ul>
            <Show when={review().notes.length > ROUND_NOTES}>
              <div class="text-12-regular text-v2-text-text-faint">
                {ctx.t("round.more", { count: review().notes.length - ROUND_NOTES })}
              </div>
            </Show>
            <Show when={review().earlier}>
              {(count) => (
                <div class="text-12-regular text-v2-text-text-muted">
                  {ctx.plural("round.earlier", count())}
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={Design.describeSystem(props.design.designSystem).trim()}>
        {(name) => (
          <div class="min-w-0 truncate text-12-regular text-v2-text-text-faint">
            {ctx.t("system", { name: name() })}
          </div>
        )}
      </Show>
      {/* The review page's actions: approve the published revision while the review is open, reopen it once ended. */}
      <Show when={props.design.ended || props.design.revision}>
        <div class="flex min-w-0 items-center gap-2 pt-1" aria-busy={props.pending}>
          <Show when={!props.design.ended && props.design.revision}>
            <Button size="small" variant="outline" disabled={props.busy} onClick={props.onApprove}>
              {ctx.t("approve")}
            </Button>
          </Show>
          <Show when={props.design.ended}>
            <Button size="small" variant="ghost" disabled={props.busy} onClick={props.onReopen}>
              {ctx.t("reopen")}
            </Button>
          </Show>
        </div>
      </Show>
    </li>
  )
}
