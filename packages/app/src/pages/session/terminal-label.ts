import { isDefaultTitle as isDefaultTerminalTitle } from "@/context/terminal-title"

export const terminalTabLabel = (input: { title?: string; titleNumber?: number }) => {
  const title = input.title ?? ""
  const number = input.titleNumber ?? 0
  const isDefaultTitle = Number.isFinite(number) && number > 0 && isDefaultTerminalTitle(title, number)

  if (title && !isDefaultTitle) return title
  if (number > 0) return `Terminal ${number}`
  if (title) return title
  return "Terminal"
}
