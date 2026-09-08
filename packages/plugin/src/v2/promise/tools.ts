import type { ToolSpec } from "../tools.js"

export interface ToolHooks {
  readonly register: (tools: Readonly<Record<string, ToolSpec>>) => Promise<void>
}
