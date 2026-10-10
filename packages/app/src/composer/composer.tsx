import { Show, createMemo } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { ComposerEditor, ComposerEditorSelect } from "./editor/editor"
import { ComposerReasoningControl } from "./reasoning/control"
import { useSettings } from "@/settings/model"
import { ModelSelectorPopover } from "@/providers/models/select-dialog"
import { DialogSelectModelUnpaid } from "@/providers/models/unpaid"
import { formatKeybind, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import type { ComposerModel } from "./model"

export function Composer(props: {
  class?: string
  model: ComposerModel
  borderUnderlay?: boolean
  readOnly?: boolean
  suggestionBoundary?: () => HTMLElement | undefined
}) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()

  return (
    <div class="flex flex-col gap-3">
      <ComposerEditor
        controller={props.model}
        borderUnderlay={props.borderUnderlay}
        readOnly={props.readOnly}
        class={props.class}
        modelControlsVisible={!props.model.model.loading}
        attachKeybind={command.keybindParts("file.attach")}
        attachShortcut={command.keybind("file.attach")}
        alternateKeybind={[formatKeybind("alt", language.t), "↵"]}
        exitShellKeybind={[formatKeybind("esc", language.t)]}
        suggestionBoundary={props.suggestionBoundary}
        modelControl={
          <ComposerModelControl
            loading={props.model.model.loading}
            paid={props.model.model.paid}
            title={language.t("command.model.choose")}
            keybind={command.keybindParts("model.choose")}
            model={props.model.model.selection}
            provider={props.model.model.selection.current()?.provider}
            modelName={props.model.model.selection.current()?.name ?? language.t("dialog.model.select.title")}
            onClose={props.model.restoreFocus}
            onUnpaidClick={() => dialog.show(() => <DialogSelectModelUnpaid model={props.model.model.selection} />)}
          />
        }
        reasoningControl={
          <Show when={props.model.reasoning}>
            {(reasoning) => (
              <ComposerReasoningControl
                reasoning={reasoning().state}
                onStatus={() => void reasoning().status()}
                onSetup={reasoning().setup}
              />
            )}
          </Show>
        }
        permissionControl={<ComposerPermissionControl />}
      />
    </div>
  )
}

function ComposerModelControl(props: {
  loading: boolean
  paid: boolean
  title: string
  keybind: string[]
  model: ComposerModel["model"]["selection"]
  provider?: { id: string; canonical?: string; name: string }
  modelName: string
  onClose: () => void
  onUnpaidClick: () => void
}) {
  const shouldAnimate = createMemo<boolean>((previous) => previous ?? props.loading)
  const mobile = createMediaQuery("(max-width: 767px)")

  const content = () => (
    <>
      <Show when={props.provider}>
        {(provider) => (
          <ProviderModelIcon
            provider={provider()}
            class="shrink-0 opacity-40 transition-opacity duration-150 group-hover:opacity-100"
          />
        )}
      </Show>
      <span class="truncate leading-4">{props.modelName}</span>
      <span class="-ml-0.5 -mr-1 flex shrink-0">
        <Icon name="chevron-down" />
      </span>
    </>
  )

  return (
    <Show when={!props.loading}>
      <Tooltip
        inactive={mobile()}
        placement="top"
        gutter={4}
        value={
          <>
            {props.title}
            <Keybind keys={props.keybind} variant="neutral" />
          </>
        }
      >
        <Show
          when={props.paid || mobile()}
          fallback={
            <Button
              data-action="composer-model"
              data-control-type="dialog"
              variant="ghost-muted"
              size="normal"
              class="min-w-0 max-w-[220px] justify-start !font-normal group"
              classList={{ "animate-in fade-in": shouldAnimate() }}
              style={{ height: "28px" }}
              onClick={props.onUnpaidClick}
            >
              {content()}
            </Button>
          }
        >
          <ModelSelectorPopover
            model={props.model}
            unpaid={!props.paid}
            trigger={(triggerProps) => (
              <Button
                {...triggerProps}
                variant="ghost-muted"
                size="normal"
                style={{ height: "28px" }}
                class="min-w-0 max-w-[220px] justify-start !font-normal group"
                classList={{ "animate-in fade-in": shouldAnimate() }}
                data-action="composer-model"
                data-control-type={mobile() ? "drawer" : "popover"}
              >
                {content()}
              </Button>
            )}
            onClose={props.onClose}
          />
        </Show>
      </Tooltip>
    </Show>
  )
}

/**
 * The permission mode, Codex's footer chip: ask before each permission request, or approve the ones no rule denies.
 * The mode is the app's auto-approve setting, so it holds for every session and server; the server has no
 * per-session mode, and `--yolo` stays a CLI flag.
 */
function ComposerPermissionControl() {
  const i18n = useI18n()
  const settings = useSettings()
  const command = useCommand()
  const current = () => (settings.permissions.autoApprove() ? "auto" : "ask")

  return (
    <ComposerEditorSelect
      mobileDrawer
      capitalize={false}
      title={i18n.t("ui.promptInput.permission.title")}
      keybind={command.keybindParts("permissions.autoaccept")}
      options={[
        { id: "ask", label: i18n.t("ui.promptInput.permission.ask") },
        { id: "auto", label: i18n.t("ui.promptInput.permission.auto") },
      ]}
      current={current()}
      currentIcon={<Icon name="shield" size="small" class="shrink-0 text-ink-muted" />}
      // The session's toggle command also confirms the change in a toast; other screens set it directly.
      onSelect={(id) => {
        if (id === current()) return

        if (command.options.some((option) => option.id === "permissions.autoaccept")) {
          void command.trigger("permissions.autoaccept")

          return
        }

        settings.permissions.setAutoApprove(id === "auto")
      }}
    />
  )
}
