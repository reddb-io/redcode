import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Tabs } from "@opencode/ui/tabs"
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
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-elevation-base-border px-3 py-2">
        <Tabs.List aria-label={ctx.t("studio.tabs")} class="flex min-w-0 gap-1">
          <Tabs.Trigger value="visual">{ctx.t("studio.visual")}</Tabs.Trigger>
          <Tabs.Trigger value="server">{ctx.t("studio.plugins")}</Tabs.Trigger>
        </Tabs.List>
        <Button variant="outline" onClick={create}>
          {ctx.t("create.title")}
        </Button>
      </div>
      <Show when={state.notice}>
        <p role="status" class="border-b border-elevation-base-border px-3 py-2 text-12-regular text-ink-muted">
          {state.notice}
        </p>
      </Show>
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
