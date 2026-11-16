import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Tabs } from "@opencode/ui/tabs"
import { Tooltip } from "@opencode/ui/tooltip"
import { useExtension, type MountedSession } from "../sdk"
import type definition from "./index"
import Components from "./components"
import Plugins from "./plugins"
import Create from "./create"

export default function Studio(props: { session: MountedSession; visible: boolean }) {
  // A session change owns a new wizard state; installations remain project scoped.
  const identity = createMemo(() => `${props.session.key}\n${props.session.directory}`)
  return (
    <Show when={identity()} keyed>
      {(_identity) => <Workspace session={props.session} visible={props.visible} />}
    </Show>
  )
}

function Workspace(props: { session: MountedSession; visible: boolean }) {
  const ctx = useExtension<typeof definition>()
  const [state, setState] = createStore({ tab: "visual", notice: "" })
  const create = () => {
    const session = props.session
    ctx.dialogs.open((dialog) => (
      <Create
        session={session}
        close={() => dialog.close()}
        started={(kind) => setState({ tab: kind, notice: ctx.t("create.started") })}
      />
    ))
  }
  return (
    <Tabs
      value={state.tab}
      onChange={(tab) => setState("tab", tab)}
      variant="pill"
      class="flex size-full min-h-0 flex-col"
    >
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-elevation-base-border px-2">
        <Tabs.List
          aria-label={ctx.t("studio.tabs")}
          class="min-w-0 flex-1"
          style={{ width: "auto", padding: "0", height: "28px" }}
        >
          <Tabs.Trigger value="visual" aria-label={ctx.t("studio.visual")}>
            {ctx.t("studio.visual.short")}
          </Tabs.Trigger>
          <Tabs.Trigger value="server" aria-label={ctx.t("studio.plugins")}>
            {ctx.t("studio.plugins.short")}
          </Tabs.Trigger>
        </Tabs.List>
        <Show when={state.notice}>
          <Tooltip value={state.notice}>
            <span role="status" aria-label={state.notice} tabIndex={0} class="shrink-0 text-ink-muted">
              <Icon name="info" size="small" />
            </span>
          </Tooltip>
        </Show>
        <Button size="small" variant="outline" icon="plus" aria-label={ctx.t("create.title")} onClick={create}>
          {ctx.t("studio.create")}
        </Button>
      </div>
      <Tabs.Content value="visual" class="flex min-h-0 flex-1 flex-col overflow-auto">
        <Components
          server={props.session.server}
          location={props.session.location}
          sessionID={props.session.id}
          visible={props.visible}
        />
      </Tabs.Content>
      <Tabs.Content value="server" class="min-h-0 flex-1 overflow-auto">
        <Show when={props.visible}>
          <Plugins server={props.session.server} location={props.session.location} session={props.session} />
        </Show>
      </Tabs.Content>
    </Tabs>
  )
}
