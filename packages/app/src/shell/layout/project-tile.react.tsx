/** @jsxImportSource react */
import { displayName, getProjectAvatarSource } from "@opencode/ui/project-avatar-data"
import type { ProjectTileProject } from "@/shell/layout/project-tile"
import { projectTileTone } from "@/shell/layout/project-tile-data"
import "@/shell/layout/project-tile.css"

export function ProjectTile(props: {
  project: ProjectTileProject
  unread?: boolean
  outline?: boolean
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}) {
  const src = props.outline ? undefined : getProjectAvatarSource(props.project.id, props.project.icon)
  return (
    <span
      data-component="project-tile"
      data-size={props.size ?? "sm"}
      data-tone={props.outline ? "outline" : projectTileTone(props.project)}
      data-has-image={src ? "" : undefined}
      className={props.className}
      aria-hidden="true"
    >
      <span data-slot="project-tile-surface">
        {src ? <img src={src} alt="" draggable={false} /> : (Array.from(displayName(props.project).trim())[0] ?? "")}
      </span>
      {props.unread && <span data-slot="project-tile-unread" />}
    </span>
  )
}
