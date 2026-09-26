import { Component, Show, createMemo, createResource } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import { SelectV2 } from "@reddb-io/redcode-ui/v2/select-v2"
import { Switch } from "@reddb-io/redcode-ui/v2/switch-v2"
import { TextInputV2 } from "@reddb-io/redcode-ui/v2/text-input-v2"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useUpdaterAction } from "../updater-action"
import { useSettings } from "@/context/settings"
import { ExternalLink } from "../external-link"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { LayoutRetirementNotice, LayoutTransitionToggle } from "./interface-transition"
import {
  createAppearanceSettingsController,
  createPermissionScopeController,
  createShellOptions,
  createShellSettingsController,
  createSoundSettingsController,
  soundOptions,
  type AppearanceSettingsController,
  type PermissionScopeController,
  type ShellSettingsController,
  type SoundSettingsController,
} from "./general-controllers"
import "./settings-v2.css"

const schemeOptions: ("system" | "light" | "dark")[] = ["system", "light", "dark"]
const fontSettings = {
  ui: {
    action: "settings-ui-font",
    title: "UI Font",
    description: "Customise the font used throughout the interface",
    font: "ui",
    input: "setUI",
  },
  code: {
    action: "settings-code-font",
    title: "Code Font",
    description: "Customise the font used in code blocks",
    font: "code",
    input: "setCode",
  },
  terminal: {
    action: "settings-terminal-font",
    title: "Terminal Font",
    description: "Customise the font used in the terminal",
    font: "terminal",
    input: "setTerminal",
  },
} as const
const soundSettings = {
  agent: {
    action: "settings-sounds-agent",
    title: "Agent",
    description: "Play sound when the agent is complete or needs attention",
  },
  permissions: {
    action: "settings-sounds-permissions",
    title: "Permissions",
    description: "Play sound when a permission is required",
  },
  errors: {
    action: "settings-sounds-errors",
    title: "Errors",
    description: "Play sound when an error occurs",
  },
} as const

const PermissionScopeSetting: Component<{ controller: PermissionScopeController }> = (props) => {
  return (
    <SettingsRowV2
      title={"Auto-accept permissions"}
      description={"Permission requests will be automatically approved"}
    >
      <div data-action="settings-auto-accept-permissions">
        <Switch
          checked={props.controller.accepting()}
          disabled={!props.controller.enabled()}
          onChange={props.controller.set}
        />
      </div>
    </SettingsRowV2>
  )
}

const ShellSetting: Component<{ controller: ShellSettingsController }> = (props) => {
  const options = createMemo(() =>
    createShellOptions({
      shells: props.controller.shells(),
      current: props.controller.current(),
    }),
  )
  return (
    <SettingsRowV2
      title={"Terminal shell"}
      description={"Shell used by the terminal and agent tools"}
    >
      <SelectV2
        appearance="inline"
        data-action="settings-shell"
        options={options()}
        current={options().find((option) => option.value === props.controller.current()) ?? options()[0]}
        placement="bottom-end"
        gutter={6}
        value={(option) => option.id}
        label={(option) => {
          if (option.id === "auto") return "Auto (Default)"
          if (!option.terminalOnly) return option.name
          return `${option.name} (${"terminal only"})`
        }}
        onSelect={(option) => option && props.controller.select(option.value)}
      />
    </SettingsRowV2>
  )
}

const AppearanceSection: Component<{ controller: AppearanceSettingsController }> = (props) => {
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{"Appearance"}</h3>
      <SettingsListV2>
        <SettingsRowV2
          title={"Color scheme"}
          description={"Choose whether Redcode follows the system, light, or dark theme"}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-color-scheme"
            options={schemeOptions}
            current={schemeOptions.find((option) => option === props.controller.scheme.current())}
            placement="bottom-end"
            gutter={6}
            label={(option) => {
              if (option === "system") return "System"
              if (option === "light") return "Light"
              return "Dark"
            }}
            onSelect={(option) => option && props.controller.scheme.select(option)}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={"Theme"}
          description={
            <>
              {"Customise how Redcode is themed."}{" "}
              <ExternalLink class="settings-v2-link" href="https://github.com/reddb-io/redcode">
                {"Learn more"}
              </ExternalLink>
            </>
          }
        >
          <SelectV2
            appearance="inline"
            data-action="settings-theme"
            options={props.controller.theme.options()}
            current={props.controller.theme.current()}
            placement="bottom-end"
            gutter={6}
            value={(option) => option.id}
            label={(option) => option.name}
            onSelect={props.controller.theme.select}
          />
        </SettingsRowV2>

        <FontSetting kind="ui" fonts={props.controller.fonts} />
        <FontSetting kind="code" fonts={props.controller.fonts} />
        <FontSetting kind="terminal" fonts={props.controller.fonts} />
      </SettingsListV2>
    </div>
  )
}

const FontSetting: Component<{
  kind: "ui" | "code" | "terminal"
  fonts: AppearanceSettingsController["fonts"]
}> = (props) => {
  const config = () => fontSettings[props.kind]
  return (
    <SettingsRowV2 title={config().title} description={config().description}>
      <div class="w-full sm:w-[220px]">
        <TextInputV2
          data-action={config().action}
          type="text"
          appearance="base"
          value={props.fonts[config().font]().value}
          onInput={(event) => props.fonts[config().input](event.currentTarget.value)}
          placeholder={props.fonts[config().font]().placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={config().title}
          style={{ "font-family": props.fonts[config().font]().family }}
        />
      </div>
    </SettingsRowV2>
  )
}

const SoundsSection: Component<{ controller: SoundSettingsController }> = (props) => {
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{"Sound effects"}</h3>
      <SettingsListV2>
        <SoundSetting kind="agent" channel={props.controller.agent} />
        <SoundSetting kind="permissions" channel={props.controller.permissions} />
        <SoundSetting kind="errors" channel={props.controller.errors} />
      </SettingsListV2>
    </div>
  )
}

const SoundSetting: Component<{
  kind: "agent" | "permissions" | "errors"
  channel: SoundSettingsController["agent"]
}> = (props) => {
  const config = () => soundSettings[props.kind]
  return (
    <SettingsRowV2 title={config().title} description={config().description}>
      <SelectV2
        appearance="inline"
        data-action={config().action}
        options={soundOptions}
        current={props.channel.current()}
        value={(option) => option.id}
        label={(option) => soundLabels[option.label] ?? option.label}
        onHighlight={props.channel.highlight}
        onSelect={props.channel.select}
        placement="bottom-end"
        gutter={6}
      />
    </SettingsRowV2>
  )
}

export const SettingsGeneralV2: Component<{
  sessionID?: string
}> = (props) => {
  const platform = usePlatform()
  const dialog = useDialog()
  const settings = useSettings()
  const mobile = createMediaQuery("(max-width: 767px)")
  const updater = useUpdaterAction()
  const permissionScope = createPermissionScopeController(() => props.sessionID)
  const shell = createShellSettingsController()
  const appearance = createAppearanceSettingsController()
  const sounds = createSoundSettingsController()
  const desktop = createMemo(() => platform.platform === "desktop")

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => desktop() && "getPinchZoomEnabled" in platform,
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

  const InterfaceSection = () => (
    <LayoutTransitionToggle
      title={"New layout"}
      badge={"New"}
      description={"Use the new tabs and home layout. Switch between layouts for a limited time."}
      checked={settings.general.newLayoutDesigns()}
      onChange={(checked) => {
        settings.general.setNewLayoutDesigns(checked)
        if (checked) return
        void import("@/components/dialog-settings").then((module) => {
          void dialog.show(() => <module.DialogSettings />)
        })
      }}
    />
  )

  const InterfaceNoticeSection = () => (
    <LayoutRetirementNotice
      title={"You're now using new layout"}
      description={"The previous layout is no longer available"}
      dismiss={"Dismiss"}
      onDismiss={() => settings.general.dismissNewInterfaceNotice()}
    />
  )

  const GeneralSection = () => (
    <div class="settings-v2-section">
      <SettingsListV2>
        <PermissionScopeSetting controller={permissionScope} />

        <ShellSetting controller={shell} />

        <SettingsRowV2
          title={"Show reasoning summaries"}
          description={"Display model reasoning summaries in the timeline"}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Expand shell tool parts"}
          description={"Show shell tool parts expanded by default in the timeline"}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Expand edit tool parts"}
          description={"Show edit, write, and patch tool parts expanded by default in the timeline"}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <Show when={mobile() && import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"}>
          <SettingsRowV2
            title={"Bottom navigation"}
            description={"Place the title bar and session tabs at the bottom of the screen on mobile"}
          >
            <div data-action="settings-mobile-titlebar-bottom">
              <Switch
                checked={settings.general.mobileTitlebarPosition() === "bottom"}
                onChange={(checked) => settings.general.setMobileTitlebarPosition(checked ? "bottom" : "top")}
              />
            </div>
          </SettingsRowV2>
        </Show>
      </SettingsListV2>
    </div>
  )

  const AdvancedSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{"Advanced"}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={"File tree"}
          description={"Show the file tree panel in sessions"}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Command palette"}
          description={"Show the search and command palette button in the title bar"}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Server status"}
          description={"Show the server status button in the title bar"}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Show agent"}
          description={"Switch between agents in the composer. When hidden, defaults to Build agent."}
        >
          <div data-action="settings-show-custom-agents">
            <Switch
              checked={settings.general.showCustomAgents()}
              onChange={(checked) => settings.general.setShowCustomAgents(checked)}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const NotificationsSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{"System notifications"}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={"Agent"}
          description={"Show system notification when the agent is complete or needs attention"}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Permissions"}
          description={"Show system notification when a permission is required"}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Errors"}
          description={"Show system notification when an error occurs"}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const UpdatesSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{"Updates"}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={"Release notes"}
          description={"Show What's New popups after updates"}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={"Check for updates"}
          description={"Manually check for updates and install if available"}
        >
          <ButtonV2 size="normal" variant="neutral" disabled={!updater.action().run} onClick={() => updater.run()}>
            {updaterLabels[updater.action().label] ?? updater.action().label}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  // We can probably remove this, right?
  const DisplaySection = () => (
    <Show when={desktop()}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{"Display"}</h3>

        <SettingsListV2>
          <SettingsRowV2
            title={"Pinch to zoom"}
            description={"Allow trackpad pinch and Ctrl-scroll gestures to zoom"}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.latest} onChange={onPinchZoomChange} />
            </div>
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </Show>
  )

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{"General"}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show when={settings.general.layoutTransitionAvailable()}>
          <InterfaceSection />
        </Show>

        <Show when={settings.general.newInterfaceNoticeVisible()}>
          <InterfaceNoticeSection />
        </Show>

        <GeneralSection />

        <AppearanceSection controller={appearance} />

        <NotificationsSection />

        <SoundsSection controller={sounds} />

        <Show when={desktop()}>
          <UpdatesSection />
        </Show>

        <DisplaySection />

        <AdvancedSection />
      </div>
    </>
  )
}

const soundLabels: Record<string, string> = {
  "sound.option.none": "None",
  "sound.option.alert01": "Alert 01",
  "sound.option.alert02": "Alert 02",
  "sound.option.alert03": "Alert 03",
  "sound.option.alert04": "Alert 04",
  "sound.option.alert05": "Alert 05",
  "sound.option.alert06": "Alert 06",
  "sound.option.alert07": "Alert 07",
  "sound.option.alert08": "Alert 08",
  "sound.option.alert09": "Alert 09",
  "sound.option.alert10": "Alert 10",
  "sound.option.bipbop01": "Bip-bop 01",
  "sound.option.bipbop02": "Bip-bop 02",
  "sound.option.bipbop03": "Bip-bop 03",
  "sound.option.bipbop04": "Bip-bop 04",
  "sound.option.bipbop05": "Bip-bop 05",
  "sound.option.bipbop06": "Bip-bop 06",
  "sound.option.bipbop07": "Bip-bop 07",
  "sound.option.bipbop08": "Bip-bop 08",
  "sound.option.bipbop09": "Bip-bop 09",
  "sound.option.bipbop10": "Bip-bop 10",
  "sound.option.staplebops01": "Staplebops 01",
  "sound.option.staplebops02": "Staplebops 02",
  "sound.option.staplebops03": "Staplebops 03",
  "sound.option.staplebops04": "Staplebops 04",
  "sound.option.staplebops05": "Staplebops 05",
  "sound.option.staplebops06": "Staplebops 06",
  "sound.option.staplebops07": "Staplebops 07",
  "sound.option.nope01": "Nope 01",
  "sound.option.nope02": "Nope 02",
  "sound.option.nope03": "Nope 03",
  "sound.option.nope04": "Nope 04",
  "sound.option.nope05": "Nope 05",
  "sound.option.nope06": "Nope 06",
  "sound.option.nope07": "Nope 07",
  "sound.option.nope08": "Nope 08",
  "sound.option.nope09": "Nope 09",
  "sound.option.nope10": "Nope 10",
  "sound.option.nope11": "Nope 11",
  "sound.option.nope12": "Nope 12",
  "sound.option.yup01": "Yup 01",
  "sound.option.yup02": "Yup 02",
  "sound.option.yup03": "Yup 03",
  "sound.option.yup04": "Yup 04",
  "sound.option.yup05": "Yup 05",
  "sound.option.yup06": "Yup 06",
}

const updaterLabels: Record<string, string> = {
  "settings.updates.action.checkNow": "Check now",
  "settings.updates.action.checking": "Checking...",
  "settings.updates.action.downloading": "Downloading...",
  "settings.updates.action.installing": "Installing...",
  "toast.update.action.installRestart": "Install and restart",
}
