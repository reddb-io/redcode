import { ProviderIcon } from "@opencode/ui/provider-icon"
import { Show } from "solid-js"

export function TimelineSeparator(props: { label: string; providerID?: string; variant?: string }) {
  return (
    <div class="flex h-8 w-full items-center gap-3 text-ink-muted">
      <span class="h-px min-w-0 flex-1 bg-elevation-base-border" />
      <span class="flex min-w-0 items-center gap-1 text-caption">
        <Show when={props.providerID}>
          {(providerID) => <ProviderIcon id={providerID()} class="text-ink-muted" aria-hidden="true" />}
        </Show>
        <span class="flex min-w-0 items-center gap-1.5">
          <bdi dir="auto" class="truncate" title={props.label}>
            {props.label}
          </bdi>
          <Show when={props.variant && props.variant !== "default" ? props.variant : undefined}>
            {(variant) => (
              <>
                <span class="flex size-1.5 shrink-0 items-center justify-center" aria-hidden="true">
                  <span class="size-[2.25px] rounded-full bg-current" />
                </span>
                <span data-slot="session-timeline-notice-variant" class="shrink-0 capitalize">
                  {variant()}
                </span>
              </>
            )}
          </Show>
        </span>
      </span>
      <span class="h-px min-w-0 flex-1 bg-elevation-base-border" />
    </div>
  )
}
