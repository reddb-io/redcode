import { createMemo, Show } from "solid-js"
import { displayName, getProjectAvatarSource } from "@opencode/ui/project-avatar"
import type { LocalProject } from "@/shell/state/layout"
import "./project-tile.css"

import { projectTileTone } from "./project-tile-data"

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
    return projectTileTone(props.project)
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

export { projectTone } from "./project-tile-data"
