import { createMemo, Show } from "solid-js"
import { displayName, getProjectAvatarSource } from "@opencode/ui/project-avatar"
import type { LocalProject } from "@/shell/state/layout"
import "./project-tile.css"

// Project icon colors map onto the six DS series roles; gray asks for the ink tile.
const SERIES: Record<string, number> = {
  blue: 1,
  orange: 2,
  cyan: 3,
  mint: 3,
  green: 3,
  lime: 3,
  purple: 4,
  yellow: 5,
  pink: 6,
  red: 6,
}

export type ProjectTileProject = Partial<Pick<LocalProject, "id" | "name" | "icon">> & Pick<LocalProject, "worktree">

export function ProjectTile(props: {
  project: ProjectTileProject
  size?: "sm" | "md" | "lg" | "xl"
  unread?: boolean
  outline?: boolean
  class?: string
}) {
  const name = createMemo(() => displayName(props.project))
  const src = createMemo(() =>
    props.outline ? undefined : getProjectAvatarSource(props.project.id, props.project.icon),
  )
  const tone = createMemo(() => {
    if (props.outline) return "outline"
    const color = props.project.icon?.color
    if (color === "gray") return "ink"
    return String(SERIES[color ?? ""] ?? projectTone(props.project.id ?? props.project.worktree))
  })
  return (
    <span
      data-component="project-tile"
      data-size={props.size ?? "sm"}
      data-tone={tone()}
      data-has-image={src() ? "" : undefined}
      class={props.class}
      aria-hidden="true"
    >
      <span data-slot="project-tile-surface">
        <Show when={src()} fallback={Array.from(name().trim())[0] ?? ""}>
          {(value) => <img src={value()} alt="" draggable={false} />}
        </Show>
      </span>
      <Show when={props.unread}>
        <span data-slot="project-tile-unread" />
      </Show>
    </span>
  )
}

/** A stable series role (1–6) for a project that never picked a color. */
export function projectTone(key: string) {
  const hash = Array.from(key).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7)
  return (hash % 6) + 1
}
