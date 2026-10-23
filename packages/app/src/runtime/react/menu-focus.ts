import type { KeyboardEvent } from "react"

/** Keep arrow navigation inside the active menu, including portalled submenus. */
export function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return
  if ((event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget) return
  if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End")) return
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])")]
  if (!rows.length) return
  const index = rows.findIndex((row) => row === event.target)
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : index < 0
          ? event.key === "ArrowDown"
            ? 0
            : rows.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length
  event.preventDefault()
  event.stopPropagation()
  rows[next].focus()
}
