import { Button } from "@opencode/ui/button"
import { sidebarPanel } from "@reddb-io/design-system/contracts/sidebar-panel"
import { onMount, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

export function AgentChangeReview(props: {
  title: string
  back: string
  busy: boolean
  error: string
  close: () => void
  children: JSX.Element
  footer: JSX.Element
}) {
  const language = useLanguage()
  const panel = sidebarPanel()
  let element: HTMLElement | undefined
  onMount(() => {
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ block: "nearest" })
  })
  return (
    <section
      ref={element}
      aria-label={props.title}
      tabIndex={-1}
      class={panel.root({
        class:
          "max-h-[min(80dvh,calc(var(--agents-content-height,100dvh)-3rem))] overflow-hidden rounded-lg border border-muted focus-visible:outline-2 focus-visible:outline-focus",
      })}
    >
      <header class={panel.toolbar()}>
        <h3 class="min-w-0 text-body font-medium">{props.title}</h3>
        <Button variant="ghost" aria-label={props.back} disabled={props.busy} onClick={props.close}>
          {language.t("agents.review.back")}
        </Button>
      </header>
      <div
        class={panel.body({
          class: "flex flex-col gap-3 overflow-auto overscroll-contain pt-[var(--reddb-spatial-inset-sm)]",
        })}
      >
        {props.children}
      </div>
      <footer class={panel.footer({ class: "flex flex-col gap-2" })}>
        <Show when={props.error}>
          <p role="alert" class="max-h-24 overflow-auto [overflow-wrap:anywhere]">
            {props.error}
          </p>
        </Show>
        {props.footer}
      </footer>
    </section>
  )
}
