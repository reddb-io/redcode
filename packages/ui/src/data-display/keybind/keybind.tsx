import { type ComponentProps, For, splitProps } from "solid-js"
import { kbd, kbdChord } from "@reddb-io/design-system/contracts/kbd"

export interface KeybindProps extends ComponentProps<"div"> {
  keys: string[]
  variant?: "neutral" | "ghost"
}

export function Keybind(props: KeybindProps) {
  const [local, rest] = splitProps(props, ["keys", "variant", "class", "classList"])

  return (
    <div
      {...rest}
      data-component="keybind-v2"
      data-variant={local.variant || "neutral"}
      class={kbdChord().root({ class: local.class })}
      classList={local.classList}
    >
      <For each={local.keys}>
        {(key) => (
          <kbd
            data-slot="keybind-v2-key"
            class={kbd({
              size: "sm",
              class: local.variant === "ghost" ? "border-transparent min-w-0 px-0" : undefined,
            })}
          >
            <span data-slot="keybind-v2-label">{key}</span>
          </kbd>
        )}
      </For>
    </div>
  )
}
