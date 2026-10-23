/** @jsxImportSource react */
import { useLayoutEffect, useRef, useState } from "react"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { Icon } from "@/runtime/react/icon.react"

export function ReasoningChoices(props: {
  label: string
  items: readonly { id: string; label: string }[]
  value: string
  select: (value: string) => void
  status?: { label: string; run: () => void }
}) {
  const root = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(props.items.findIndex((item) => item.id === props.value))
  useLayoutEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus()
  }, [])
  const count = props.items.length + (props.status ? 1 : 0)
  return (
    <div
      ref={root}
      role="menu"
      aria-label={props.label}
      className="flex min-w-0 flex-col gap-1"
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : (active + (event.key === "ArrowDown" ? 1 : -1) + count) % count
        setActive(next)
        root.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
      }}
    >
      {props.items.map((item, index) => (
        <ListRow
          key={item.id}
          role="menuitemradio"
          aria-checked={props.value === item.id}
          tabIndex={active === index ? 0 : -1}
          selected={props.value === item.id}
          className="w-full"
          trailing={props.value === item.id && <Icon name="check" size="small" />}
          onFocus={() => setActive(index)}
          onClick={() => props.select(item.id)}
        >
          {item.label}
        </ListRow>
      ))}
      {props.status && (
        <>
          <hr className="my-1 border-muted" />
          <ListRow
            role="menuitem"
            tabIndex={active === props.items.length ? 0 : -1}
            className="w-full"
            onFocus={() => setActive(props.items.length)}
            onClick={props.status.run}
          >
            {props.status.label}
          </ListRow>
        </>
      )}
    </div>
  )
}
