import { Show } from "solid-js"
import { HomeSessionStatusController, type HomeSessionRecord } from "./controller"
import type { HomeSessionsViewProps } from "./view"

export function HomeSessionStatus(props: {
  server: HomeSessionsViewProps["server"]
  isOpenTab: HomeSessionsViewProps["isOpenTab"]
  record: HomeSessionRecord
  workingLabel: string
}) {
  return (
    <HomeSessionStatusController
      server={props.server}
      record={props.record}
      isOpenTab={props.isOpenTab}
      render={(state) => (
        <span data-slot="home-session-status" class="flex size-4 shrink-0 items-center justify-center">
          <Show
            when={state.loading()}
            fallback={
              <Show when={state.unread() || state.open()}>
                <span
                  aria-hidden="true"
                  class="size-1.5 rounded-full"
                  classList={{
                    "bg-foreground": state.unread(),
                    "border border-ink-muted": !state.unread(),
                  }}
                />
              </Show>
            }
          >
            <span
              role="img"
              aria-label={props.workingLabel}
              title={props.workingLabel}
              class="relative flex size-2 items-center justify-center"
            >
              <span class="absolute inset-0 rounded-full bg-feedback-success-foreground opacity-40 motion-safe:animate-ping" />
              <span class="relative size-2 rounded-full bg-feedback-success-foreground" />
            </span>
          </Show>
        </span>
      )}
    />
  )
}
