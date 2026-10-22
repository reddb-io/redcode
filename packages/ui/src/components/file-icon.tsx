import type { Component, JSX } from "solid-js"
import { createMemo, createUniqueId, splitProps, Show } from "solid-js"
import sprite from "./file-icons/sprite.svg"
import { chooseIconName } from "./file-icon-data"
export { chooseIconName } from "./file-icon-data"

export type FileIconProps = JSX.GSVGAttributes<SVGSVGElement> & {
  node: { path: string; type: "file" | "directory" }
  expanded?: boolean
  mono?: boolean
}

export const FileIcon: Component<FileIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["node", "class", "classList", "expanded", "mono"])
  const name = createMemo(() => chooseIconName(local.node.path, local.node.type, local.expanded || false))
  const id = `file-icon-mono-${createUniqueId()}`

  return (
    <svg
      data-component="file-icon"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.mono} fallback={<use href={`${sprite}#${name()}`} />}>
        <defs>
          <mask id={id} mask-type="alpha">
            <use href={`${sprite}#${name()}`} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="currentColor" mask={`url(#${id})`} />
      </Show>
    </svg>
  )
}
