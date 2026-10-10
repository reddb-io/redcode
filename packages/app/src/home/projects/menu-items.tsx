import { Menu } from "@opencode/ui/menu"
import { For } from "solid-js"
import { useProjectMenuItems } from "@/runtime/extension/projects"

/** Extension "project" menu items for one project, placed inside that project row's menu. */
export function ProjectMenuItems(props: { server: string; directory: string }) {
  const items = useProjectMenuItems()

  return (
    <For each={items()}>
      {(item) => <Menu.Item onSelect={() => item.run(props.server, props.directory)}>{item.title}</Menu.Item>}
    </For>
  )
}
