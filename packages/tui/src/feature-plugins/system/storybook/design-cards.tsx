import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import { DesignNotice } from "@opencode/schema/design-notice"
import { DesignApprovalNotice } from "../../../component/design-approval"
import { DesignFeedbackNotice } from "../../../component/design-feedback"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

// Rendered the way the server admits them, so the cards go through the same parsing as a transcript.
const FEEDBACK = {
  notes: [
    '<design-review id="design_checkout" revision="rev_2" feedback="msg_review_notes" variant="stone" ended="false">',
    "## Message",
    "Close, but the summary feels cramped.",
    "",
    "## Notes (2)",
    '### 1. h1 "Checkout" — main > h1',
    "Note: Make this title more prominent",
    "",
    "### 2. Order summary — aside.summary",
    "Note: Give the totals more room",
    "    and align the prices.",
    "",
    "## Attachments",
    "- image 1: reference.png (attached as a file)",
    "",
    "## Next step",
    'A page-text snapshot was captured; fetch it with design_read {"id":"design_checkout","section":"snapshot","feedback":"msg_review_notes"} if you need page context.',
    "</design-review>",
  ].join("\n"),
  operation: [
    '<design-review id="design_checkout" revision="rev_3" feedback="msg_review_merge" ended="false">',
    "## Variant operation",
    "Operation: merge Spacious + Compact",
    "Kind: merge",
    "",
    "## Next step",
    "Publish a new revision with design_preview and reply with a short summary of what changed.",
    "</design-review>",
  ].join("\n"),
  ended: [
    '<design-review id="design_checkout" revision="rev_4" feedback="msg_review_end" ended="true">',
    "## Message",
    "Ship it.",
    "",
    "## Next step",
    "The user ended this review. Finish from these notes; do not reopen it without an explicit request.",
    "</design-review>",
  ].join("\n"),
}
const KINDS = ["notes", "operation", "ended"] as const

const APPROVAL = {
  variant: "Design Checkout, revision rev_4, variant Stone (stone), approved. Continue in Plan.",
  revision: "Design Checkout, revision rev_4, approved. Continue in Plan.",
}

function DesignCardsStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [kind, setKind] = createSignal<(typeof KINDS)[number]>("notes")
  const [target, setTarget] = createSignal(true)
  const [variant, setVariant] = createSignal(true)
  const [status, setStatus] = createSignal("")
  const feedback = createMemo(() => {
    const notice = DesignNotice.feedback(FEEDBACK[kind()])
    return notice && target() ? { ...notice, target: "iOS app" } : notice
  })
  const approval = createMemo(() =>
    DesignNotice.approval({
      text: APPROVAL[variant() ? "variant" : "revision"],
      metadata: { source: "design.approval", designID: "design_checkout", revision: "rev_4" },
    }),
  )
  const reset = () => {
    setKind("notes")
    setTarget(true)
    setVariant(true)
    setStatus("")
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "f",
        title: "Next feedback fixture",
        group: "Storybook",
        run: () => setKind((current) => KINDS[(KINDS.indexOf(current) + 1) % KINDS.length]),
      },
      { bind: "t", title: "Toggle design target", group: "Storybook", run: () => setTarget((value) => !value) },
      { bind: "v", title: "Toggle approved variant", group: "Storybook", run: () => setVariant((value) => !value) },
      { bind: "r", title: "Reset story", group: "Storybook", run: reset },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box paddingLeft={2} paddingRight={2} paddingTop={1} flexGrow={1} flexDirection="column">
        <Show when={feedback()}>{(notice) => <DesignFeedbackNotice notice={notice()} />}</Show>
        <Show when={approval()}>
          {(notice) => (
            <DesignApprovalNotice notice={notice()} onOpen={() => setStatus("Open design and decisions requested")} />
          )}
        </Show>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / design cards"
        details={[
          `feedback: ${kind()}`,
          target() ? "target: iOS app" : "no target",
          variant() ? "variant" : "entire revision",
        ]}
        status={status() || undefined}
        controls={[
          { shortcut: "f", label: "feedback fixture" },
          { shortcut: "t", label: "target" },
          { shortcut: "v", label: "variant" },
          { shortcut: "click", label: "open review" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const designCardsStory: Story = {
  id: "design-cards",
  title: "Design review cards",
  render: (context) => <DesignCardsStory context={context} />,
}
