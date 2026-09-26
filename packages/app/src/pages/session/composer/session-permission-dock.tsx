import { For, Show } from "solid-js"
import type { PermissionRequest } from "@reddb-io/redcode-sdk/v2"
import { Button } from "@reddb-io/redcode-ui/button"
import { DockPrompt } from "@reddb-io/redcode-session-ui/dock-prompt"
import { Icon } from "@reddb-io/redcode-ui/icon"

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: "Reading a file (matches the file path)",
  edit: "Modify files, including edits, writes, and patches",
  glob: "Match files using glob patterns",
  grep: "Search file contents using regular expressions",
  list: "List files within a directory",
  bash: "Run shell commands",
  task: "Launch sub-agents",
  skill: "Load a skill by name",
  lsp: "Run language server queries",
  todowrite: "Update the todo list",
  webfetch: "Fetch content from a URL",
  websearch: "Search the web",
  external_directory: "Access files outside the project directory",
  doom_loop: "Detect repeated tool calls with identical input",
}

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {

  const toolDescription = () => TOOL_DESCRIPTIONS[props.request.permission] ?? ""

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{"Permission required"}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {"Deny"}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {"Allow always"}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {"Allow once"}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
