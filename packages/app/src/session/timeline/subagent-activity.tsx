import { For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"

export type ActiveSubagent = { sessionID?: string; title?: string; agent?: string }

/** The parent already receives these lifecycle events; this view starts no polling or child transcript loads. */
export function SubagentActivity(props: { items: readonly ActiveSubagent[]; open: (sessionID: string) => void }) {
  const language = useLanguage()
  const name = (item: ActiveSubagent) => item.title || item.agent || language.t("ui.tool.agent.default")
  return (
    <section
      aria-label={language.t("session.subagents.label")}
      class="mt-2 min-w-0 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base"
    >
      <div class="flex items-center gap-2 px-3 py-2 text-13-medium text-v2-text-text-base">
        <span class="flex size-4 shrink-0 items-center justify-center text-v2-text-text-muted" aria-hidden="true">
          <Icon name="subagent" size="small" />
        </span>
        <span aria-live="polite">{language.plural("session.subagents.active", props.items.length)}</span>
      </div>
      <ul class="m-0 max-h-48 list-none overflow-y-auto border-t border-v2-border-border-base p-1">
        <For each={props.items}>
          {(item) => (
            <li>
              <Show
                when={item.sessionID}
                fallback={
                  <div class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5">
                    <span
                      aria-hidden="true"
                      class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent motion-safe:animate-pulse"
                    />
                    <span class="min-w-0 flex-1 truncate text-13-regular">{name(item)}</span>
                    <span class="shrink-0 text-caption text-v2-text-text-muted">
                      {language.t("session.subagents.starting")}
                    </span>
                  </div>
                }
              >
                {(id) => (
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                    aria-label={language.t("session.subagents.open", { title: name(item) })}
                    onClick={() => props.open(id())}
                  >
                    <span
                      aria-hidden="true"
                      class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent motion-safe:animate-pulse"
                    />
                    <span class="min-w-0 flex-1 truncate text-13-regular" dir="auto">
                      {name(item)}
                    </span>
                    <Show when={item.agent}>
                      <span class="max-w-24 shrink-0 truncate text-caption text-v2-text-text-muted">{item.agent}</span>
                    </Show>
                    <span class="shrink-0 text-caption text-v2-text-text-muted">
                      {language.t("session.subagents.working")}
                    </span>
                    <span class="shrink-0 text-caption text-v2-text-text-base">
                      {language.t("session.subagents.openAction")}
                    </span>
                    <Icon name="chevron-right" size="small" />
                  </button>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
