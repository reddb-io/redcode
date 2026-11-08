import type { CliRenderer } from "@opentui/core"

type TitleRenderer = Pick<CliRenderer, "setTerminalTitle">

export function setTerminalTitle(renderer: TitleRenderer, title: string) {
  // OpenTUI rejects terminal control characters in a title. Session titles can contain newlines or
  // other generated control bytes, so keep those values from taking down the entire TUI.
  renderer.setTerminalTitle(title.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " "))
}

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  setTerminalTitle(renderer, "")
  if (renderer.isDestroyed) return
  renderer.destroy()
}
