import { steps } from "@reddb-io/design-system/contracts/steps"
import { Index, Show } from "solid-js"

export function Steps(props: {
  label: string
  completedLabel: string
  items: readonly { id: string; label: string; state: "complete" | "current" | "upcoming"; select?: () => void }[]
}) {
  const appearance = steps()
  return (
    <nav aria-label={props.label} class={appearance.root({ class: "shrink-0" })}>
      <ol class={appearance.list({ class: "grid-cols-2 sm:grid-cols-4" })}>
        <Index each={props.items}>
          {(item, index) => (
            <li class={appearance.item()}>
              <Show
                when={item().select && item().state !== "current"}
                fallback={
                  <span
                    aria-current={item().state === "current" ? "step" : undefined}
                    class={appearance.content({ class: "min-h-[var(--reddb-spatial-target-min)]" })}
                  >
                    <span aria-hidden="true" class={appearance.marker()}>
                      {item().state === "complete" ? "✓" : index + 1}
                    </span>
                    <span class={item().state === "current" ? appearance.current() : undefined}>{item().label}</span>
                  </span>
                }
              >
                <button
                  type="button"
                  class={appearance.content({
                    class:
                      "min-h-[var(--reddb-spatial-target-min)] w-full rounded text-start focus-visible:outline-2 focus-visible:outline-focus",
                  })}
                  onClick={() => item().select?.()}
                >
                  <span aria-hidden="true" class={appearance.marker()}>
                    {item().state === "complete" ? "✓" : index + 1}
                  </span>
                  <span>{item().label}</span>
                  <Show when={item().state === "complete"}>
                    <span class="sr-only">{props.completedLabel}</span>
                  </Show>
                </button>
              </Show>
            </li>
          )}
        </Index>
      </ol>
    </nav>
  )
}
