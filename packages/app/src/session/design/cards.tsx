import { For, Show } from "solid-js"
import type { Design } from "@opencode/schema/design"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * Transcript card for admitted browser feedback, in place of the rendered `<design-review>` prompt the
 * model reads: the reviewer's message, the numbered notes and what came with them.
 */
export function DesignFeedbackCard(props: { notice: Design.FeedbackNotice }) {
  const language = useLanguage()
  const details = () =>
    [
      props.notice.id,
      props.notice.target,
      props.notice.revision,
      props.notice.variant ?? undefined,
      props.notice.ended ? language.t("session.design.feedback.ended") : undefined,
    ]
      .filter(Boolean)
      .join(" · ")

  return (
    <div
      data-component="design-feedback-card"
      class="flex min-w-0 flex-col gap-2 rounded-[10px] bg-v2-background-bg-layer-01 px-4 py-3 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
    >
      <div class="flex min-w-0 items-center gap-2 text-12-medium">
        <span class="shrink-0 text-v2-text-text-base">{language.t("session.design.feedback.title")}</span>
        <bdi dir="ltr" class="min-w-0 truncate text-v2-text-text-muted">
          {details()}
        </bdi>
      </div>
      <Show when={props.notice.operation}>
        {(operation) => (
          <div class="text-13-regular text-v2-text-text-base">
            {language.t("session.design.feedback.operation", { operation: operation() })}
          </div>
        )}
      </Show>
      <Show when={props.notice.text}>
        <bdi dir="auto" class="block whitespace-pre-wrap break-words text-14-regular text-v2-text-text-base">
          {props.notice.text}
        </bdi>
      </Show>
      <Show when={props.notice.notes.length}>
        <ol class="flex min-w-0 flex-col gap-1 text-13-regular text-v2-text-text-base">
          <For each={props.notice.notes}>
            {(note, index) => (
              <li class="min-w-0 break-words">
                <span class="text-v2-text-text-muted">{index() + 1}. </span>
                <bdi dir="auto" class="font-[530]">
                  {note.label}
                </bdi>
                <span class="text-v2-text-text-muted"> — </span>
                <bdi dir="auto" class="whitespace-pre-wrap">
                  {note.text}
                </bdi>
              </li>
            )}
          </For>
        </ol>
      </Show>
      <Show when={props.notice.attachments.length}>
        <div class="flex min-w-0 flex-wrap gap-1.5">
          <For each={props.notice.attachments}>
            {(name) => (
              <span class="max-w-full truncate rounded-md bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-12-regular text-v2-text-text-muted">
                {language.t("session.design.feedback.image", { name })}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.notice.snapshot}>
        <div class="text-12-regular text-v2-text-text-muted">{language.t("session.design.feedback.snapshot")}</div>
      </Show>
    </div>
  )
}

/** Transcript card of a Design approval: what was approved, and the way back to the session's designs. */
export function DesignApprovalCard(props: { notice: Design.ApprovalNotice; onOpen: () => void }) {
  const language = useLanguage()
  return (
    <div
      data-component="design-approval-card"
      class="flex min-w-0 flex-col items-start gap-1 rounded-[10px] bg-v2-background-bg-layer-01 px-4 py-3 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
    >
      <div class="flex min-w-0 max-w-full items-center gap-2 text-13-medium">
        <span class="shrink-0 text-v2-text-text-accent">{language.t("session.design.approval.title")}</span>
        <bdi dir="auto" class="min-w-0 truncate text-v2-text-text-base">
          {props.notice.name}
        </bdi>
      </div>
      <div class="flex min-w-0 max-w-full items-center gap-2 text-12-regular">
        <bdi dir="auto" class="min-w-0 truncate text-v2-text-text-base">
          {props.notice.variant?.name ?? language.t("session.design.approval.entire")}
        </bdi>
        <bdi dir="ltr" class="shrink-0 text-v2-text-text-muted">
          {props.notice.revision}
        </bdi>
      </div>
      <div class="text-12-regular text-v2-text-text-muted">{language.t("session.design.approval.saved")}</div>
      <button
        type="button"
        class="mt-1 text-12-medium text-v2-text-text-accent hover:underline"
        onClick={() => props.onOpen()}
      >
        {language.t("session.design.approval.open")}
      </button>
    </div>
  )
}
