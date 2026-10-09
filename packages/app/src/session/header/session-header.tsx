import { createMediaQuery } from "@solid-primitives/media"
import { Show } from "solid-js"

/** Reserves the session header's end for the panel toggles the screen overlays there; the screen sets their width. */
export function SessionHeaderSpacer(props: { visible: boolean }) {
  const isDesktop = createMediaQuery("(min-width: 768px)")

  return (
    <Show when={isDesktop() && props.visible}>
      <div class="h-7 w-[var(--session-header-toggles-width,28px)] shrink-0" aria-hidden />
    </Show>
  )
}
