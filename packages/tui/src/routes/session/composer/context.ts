import { createContext, useContext } from "solid-js"

export interface ComposerHint {
  id?: string
  label: string
  shortcut: string
  onSelect?: () => void
  tone?: "destructive"
}

export interface ComposerTab {
  id: string
  label: string
  hints?: () => ComposerHint[]
  onClose?: () => void
}

export const ComposerContext = createContext<{
  register: (tab: ComposerTab) => () => void
  active: (id: string) => boolean
  close: () => void
}>()

export function useComposerTab() {
  const ctx = useContext(ComposerContext)
  if (!ctx) throw new Error("useComposerTab must be used within a Composer")
  return ctx
}
