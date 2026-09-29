import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SessionLocation } from "../../component/session-location"
import { hasConnectedProvider } from "../../util/connected-provider"

export function SidebarOnboarding(props: { context: Plugin.Context; sessionID: string }) {
  const dimensions = useTerminalDimensions()
  const [onboarding, updateOnboarding] = props.context.storage.store("getting-started", {
    initial: { dismissed: false },
  })
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const integrations = createMemo(() =>
    props.context.data.location.integration.list(session()?.location ?? props.context.location),
  )
  const showOnboarding = createMemo(() => {
    if (dimensions().height < 22) return false
    const list = integrations()
    if (!list) return false
    return !onboarding.dismissed && !hasConnectedProvider(list)
  })

  return (
    <Show when={showOnboarding()}>
      <box
        id="sidebar.footer.getting-started"
        backgroundColor={props.context.theme.background.raised.high}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={1}
      >
        <text flexShrink={0} fg={props.context.theme.text.base}>
          ⬖
        </text>
        <box flexGrow={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={props.context.theme.text.base}>
              <b>Getting started</b>
            </text>
            <text
              id="sidebar.footer.getting-started.dismiss"
              fg={props.context.theme.text.muted}
              onMouseUp={() => {
                void updateOnboarding((draft) => {
                  draft.dismissed = true
                }).catch((error) => console.error("Failed to dismiss sidebar onboarding", error))
              }}
            >
              ✕
            </text>
          </box>
          <text fg={props.context.theme.text.muted}>Connect your providers to start working with Redcode.</text>
          <text fg={props.context.theme.text.muted}>
            Choose the providers and models you want to use, including Claude, GPT and Gemini.
          </text>
          <box
            id="sidebar.footer.getting-started.connect"
            flexDirection="row"
            gap={1}
            justifyContent="space-between"
            onMouseUp={() => props.context.keymap.dispatch("provider.connect")}
          >
            <text fg={props.context.theme.text.base}>Connect provider</text>
            <text fg={props.context.theme.text.muted}>/connect</text>
          </box>
        </box>
      </box>
    </Show>
  )
}

export function SidebarFooter(props: { context: Plugin.Context; sessionID: string }) {
  return (
    <box gap={1}>
      <SidebarOnboarding context={props.context} sessionID={props.sessionID} />
      <SessionLocation sessionID={props.sessionID} id="sidebar.footer.location" />
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.footer",
  setup(context) {
    // Append keeps the path open to additive plugin claims; an external
    // replace still takes the boundary over.
    context.ui.slot({
      append: "sidebar.footer",
      render: (props) => <SidebarFooter context={context} sessionID={props.sessionID} />,
    })
  },
})
