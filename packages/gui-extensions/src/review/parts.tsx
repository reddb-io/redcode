import { Match, Show, Switch } from "solid-js"
import { SessionReviewEmptyChangesV2 } from "@opencode/session-ui/v2/session-review-empty-changes-v2"
import { SessionReviewEmptyNoGitV2 } from "@opencode/session-ui/v2/session-review-empty-no-git-v2"
import { quietControl } from "@opencode/ui/contracts/quiet-control"
import { Icon } from "@opencode/ui/icon"
import { Select } from "@opencode/ui/select"
import { useExtension } from "../sdk"
import type { ChangeMode, ReviewModel } from "./model"

export function ReviewTitle(props: { review: ReviewModel }) {
  const ctx = useExtension()

  const label = (option: ChangeMode) => {
    if (option === "git") return ctx.t("ui.sessionReview.title.git")

    if (option === "branch") return ctx.t("ui.sessionReview.title.branch")

    return ctx.t("ui.sessionReview.title.lastTurn")
  }

  return (
    <Show when={props.review.canReview() && props.review.options().length > 0}>
      <Show
        when={props.review.options().length === 1 && props.review.options()[0]}
        fallback={
          <Select
            options={props.review.options()}
            current={props.review.mode()}
            label={label}
            placement="bottom-start"
            gutter={6}
            onSelect={(option) => option && props.review.setMode(option)}
          />
        }
      >
        {(only) => (
          <span class="inline-flex h-6 items-center ps-2 pe-1 text-[13px] leading-[var(--line-height-compact)] font-[530] tracking-[-0.04px] text-v2-text-text-base">
            {label(only())}
          </span>
        )}
      </Show>
    </Show>
  )
}

export function ReviewEmpty(props: { review: ReviewModel; loadingClass: string }) {
  const ctx = useExtension()
  const loading = () => !props.review.ready()

  const text = () => {
    if (props.review.mode() === "git") return ctx.t("empty.git")

    if (props.review.mode() === "branch") return ctx.t("empty.branch")

    return ctx.t("noChanges")
  }

  return (
    <Switch>
      <Match when={loading()}>
        <div class={props.loadingClass}>{ctx.t("loadingChanges")}</div>
      </Match>
      <Match when={props.review.noGit()}>
        <div class="h-full flex flex-col">
          <SessionReviewEmptyNoGitV2 pending={props.review.initializingGit()} onInitGit={props.review.initializeGit} />
        </div>
      </Match>
      <Match when={true}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
          <div class="text-14-regular text-text-weak max-w-56">{text()}</div>
        </div>
      </Match>
    </Switch>
  )
}

export function ReviewPanelEmpty(props: { review: ReviewModel }) {
  const ctx = useExtension()
  const loading = () => !props.review.ready()

  return (
    <Switch>
      <Match when={loading()}>
        <div class="px-6 py-4 text-text-weak">{ctx.t("loadingChanges")}</div>
      </Match>
      <Match when={props.review.noGit()}>
        <SessionReviewEmptyNoGitV2 pending={props.review.initializingGit()} onInitGit={props.review.initializeGit} />
      </Match>
      <Match when={true}>
        <SessionReviewEmptyChangesV2 />
      </Match>
    </Switch>
  )
}

/** "Showing 3 files from this turn · Show all": the review's scope to one turn's files, and the way back to all. */
export function ReviewScopeNotice(props: { review: ReviewModel }) {
  const ctx = useExtension()

  return (
    <Show when={props.review.scope()}>
      {(scope) => (
        <div
          data-component="review-scope"
          role="status"
          class="flex min-h-7 min-w-0 items-center gap-1.5 rounded-md bg-muted py-0.5 ps-2 pe-0.5 text-caption text-ink-muted"
        >
          <Icon name="review" size="small" class="shrink-0" />
          <span class="min-w-0 flex-1 leading-tight tabular-nums">
            {scope().matched > 0
              ? ctx.plural("scope.showing", scope().matched)
              : ctx.plural("scope.none", scope().requested)}
          </span>
          <button
            type="button"
            class={quietControl({
              ink: "foreground",
              class: "h-6 shrink-0 rounded-md px-1.5 text-caption font-medium",
            })}
            onClick={() => props.review.clearScope()}
          >
            {ctx.t("scope.showAll")}
          </button>
        </div>
      )}
    </Show>
  )
}
