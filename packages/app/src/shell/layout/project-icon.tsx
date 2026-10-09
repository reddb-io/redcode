import type { LocalProject } from "@/shell/state/layout"
import { ProjectTile } from "@/shell/layout/project-tile"

export function ProjectIcon(props: {
  project: Pick<LocalProject, "id" | "name" | "worktree" | "icon">
  /** The name the initial comes from while it is being edited. */
  fallback?: string
  icon?: LocalProject["icon"]
  size?: "sm" | "md" | "lg" | "xl"
  unread?: boolean
  class?: string
}) {
  return (
    <ProjectTile
      project={{
        ...props.project,
        name: props.fallback ?? props.project.name,
        icon: props.icon ?? props.project.icon,
      }}
      size={props.size}
      unread={props.unread}
      class={props.class}
    />
  )
}
