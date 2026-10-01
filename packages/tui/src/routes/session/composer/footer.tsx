import type { ScrollBoxRenderable } from "@opentui/core"
import { createMemo, For } from "solid-js"
import { useTheme } from "../../../context/theme"
import { stringWidth } from "../../../util/string-width"
import type { ComposerHint } from "./context"

export function ComposerFooter(props: { hints: ComposerHint[] }) {
  const theme = useTheme()
  const width = createMemo(
    () =>
      1 +
      props.hints.reduce((sum, hint) => sum + stringWidth(`${hint.label} ${hint.shortcut}`), 0) +
      Math.max(0, props.hints.length - 1) * 2,
  )
  // Solid applies props after construction, so override the scrollbox's initial 100% content cap.
  let scroll: ScrollBoxRenderable | undefined
  return (
    <scrollbox
      id="composer-actions"
      ref={(value) => (scroll = value)}
      onMouseScroll={(event) => {
        if (!event.scroll || !scroll || scroll.scrollWidth <= scroll.width) return
        event.preventDefault()
        event.stopPropagation()
        const backwards = event.scroll.direction === "up" || event.scroll.direction === "left"
        scroll.scrollBy({ x: (backwards ? -1 : 1) * event.scroll.delta * 4, y: 0 })
      }}
      height={1}
      minHeight={0}
      flexShrink={0}
      scrollX
      scrollY={false}
      horizontalScrollbarOptions={{ visible: false }}
      verticalScrollbarOptions={{ visible: false }}
      contentOptions={{ flexDirection: "row", gap: 2, paddingLeft: 1, width: width(), maxWidth: width() }}
    >
      <For each={props.hints}>
        {(hint) => (
          <text id={hint.id} wrapMode="none" flexShrink={0} onMouseUp={hint.onSelect}>
            <span style={{ fg: hint.onSelect ? theme.text.action[hint.tone ?? "primary"].base : theme.text.base }}>
              <b>{hint.label}</b>{" "}
            </span>
            <span style={{ fg: theme.text.muted }}>{hint.shortcut}</span>
          </text>
        )}
      </For>
    </scrollbox>
  )
}
