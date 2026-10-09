import type { JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { useExtension } from "../sdk"
import type definition from "./index"

export default function UpdatesSection(props: {
  /** Undefined while main is not active. */
  upgradable: () => boolean | undefined
  checking: () => boolean
  run: () => void
}) {
  const ctx = useExtension<typeof definition>()
  const releaseNotes = ctx.stores.releaseNotes

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section.title")}</h3>

      <div data-component="settings-list">
        <Row title={ctx.t("releaseNotes.title")} description={ctx.t("releaseNotes.description")}>
          <div data-action="settings-release-notes">
            <Switch
              checked={releaseNotes.value.enabled}
              onChange={(checked) =>
                releaseNotes.update((draft) => {
                  draft.enabled = checked
                })
              }
            />
          </div>
        </Row>

        <Row
          title={ctx.t("check.title")}
          description={ctx.t(props.upgradable() === false ? "check.development" : "check.description")}
        >
          <Button
            data-action="settings-check-updates"
            size="normal"
            variant="neutral"
            disabled={!props.upgradable() || props.checking()}
            onClick={() => props.run()}
          >
            {ctx.t(props.checking() ? "action.checking" : "action.checkNow")}
          </Button>
        </Row>
      </div>
    </div>
  )
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
