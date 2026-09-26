import { Component, Show, createMemo, createResource, onMount, type JSX } from "solid-js"
import { Button } from "@reddb-io/redcode-ui/button"
import { Icon } from "@reddb-io/redcode-ui/icon"
import { Select } from "@reddb-io/redcode-ui/select"
import { Switch } from "@reddb-io/redcode-ui/switch"
import { TextField } from "@reddb-io/redcode-ui/text-field"
import { Tooltip } from "@reddb-io/redcode-ui/tooltip"
import { Tag } from "@reddb-io/redcode-ui/v2/badge-v2"
import { useTheme, type ColorScheme } from "@reddb-io/redcode-ui/theme/context"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { useParams } from "@solidjs/router"
import { usePermission } from "@/context/permission"
import { usePlatform, type DisplayBackend } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useUpdaterAction } from "./updater-action"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  terminalDefault,
  terminalFontFamily,
  terminalInput,
  useSettings,
} from "@/context/settings"
import { decode64 } from "@/utils/base64"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { ExternalLink } from "./external-link"
import { SettingsList } from "./settings-list"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

type ThemeOption = {
  id: string
  name: string
}

type ShellOption = {
  path: string
  name: string
  acceptable: boolean
}

type ShellSelectOption = {
  id: string
  value: string
  label: string
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const permission = usePermission()
  const platform = usePlatform()
  const dialog = useDialog()
  const params = useParams()
  const settings = useSettings()

  const updater = useUpdaterAction()

  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const dir = createMemo(() => decode64(params.dir))
  const accepting = createMemo(() => {
    const value = dir()
    if (!value) return false
    if (!params.id) return permission.isAutoAcceptingDirectory(value)
    return permission.isAutoAccepting(params.id, value)
  })

  const toggleAccept = (checked: boolean) => {
    const value = dir()
    if (!value) return

    if (!params.id) {
      if (permission.isAutoAcceptingDirectory(value) === checked) return
      permission.toggleAutoAcceptDirectory(value)
      return
    }

    if (checked) {
      permission.enableAutoAccept(params.id, value)
      return
    }

    permission.disableAutoAccept(params.id, value)
  }
  const desktop = createMemo(() => platform.platform === "desktop")

  const themeOptions = createMemo<ThemeOption[]>(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  const serverSync = useServerSync()
  const serverSdk = useServerSDK()

  const [shells] = createResource(
    async () => {
      const sdk = serverSdk()
      if ((await sdk.protocol) === "v1") {
        return (await sdk.client.pty.shells()).data ?? []
      }
      // return (await sdk.api.pty.shells()).data
      return [] as ShellOption[]
    },
    { initialValue: [] as ShellOption[] },
  )

  const [displayBackend, { refetch: refetchDisplayBackend }] = createResource(
    () => (linux() && platform.getDisplayBackend ? true : false),
    () => Promise.resolve(platform.getDisplayBackend?.() ?? null).catch(() => null as DisplayBackend | null),
    { initialValue: null as DisplayBackend | null },
  )

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => (desktop() && platform.getPinchZoomEnabled ? true : false),
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  onMount(() => {
    void theme.loadThemes()
  })

  const autoOption = { id: "auto", value: "", label: "Auto (Default)" }
  const currentShell = createMemo(() => serverSync().data.config.shell ?? "")

  const shellOptions = createMemo<ShellSelectOption[]>(() => {
    const list = shells.latest
    const current = serverSync().data.config.shell

    const nameCounts = new Map<string, number>()
    for (const s of list) {
      nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1)
    }

    const options = [
      autoOption,
      ...list.map((s) => {
        const ambiguousName = (nameCounts.get(s.name) || 0) > 1
        const text = ambiguousName ? s.path : s.name
        const label = s.acceptable ? text : `${text} (${"terminal only"})`
        return {
          id: s.path,
          // Prefer name over path - "bash" is much cleaner than the explicit full route even when it may change due to PATH.
          value: ambiguousName ? s.path : s.name,
          label,
        }
      }),
    ]

    if (current && !options.some((o) => o.value === current)) {
      options.push({ id: current, value: current, label: current })
    }

    return options
  })

  const onDisplayBackendChange = (checked: boolean) => {
    const update = platform.setDisplayBackend?.(checked ? "wayland" : "auto")
    if (!update) return
    void update.finally(() => {
      void refetchDisplayBackend()
    })
  }

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ])

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())
  const terminal = () => terminalInput(settings.appearance.terminalFont())

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => soundLabels[o.label] ?? o.label,
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  const InterfaceSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={
            <span class="flex items-center gap-2">
              {"New layout"}
              <Tag variant="accent">{"New"}</Tag>
            </span>
          }
          description={"Use the new tabs and home layout. Switch between layouts for a limited time."}
        >
          <div data-action="settings-new-layout-designs">
            <Switch
              checked={settings.general.newLayoutDesigns()}
              onChange={(checked) => {
                settings.general.setNewLayoutDesigns(checked)
                if (!checked) return
                void import("@/components/settings-v2").then((module) => {
                  void dialog.show(() => <module.DialogSettings />)
                })
              }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const InterfaceNoticeSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={"You're now using new layout"}
          description={"The previous layout is no longer available"}
        >
          <Button size="small" variant="ghost" onClick={settings.general.dismissNewInterfaceNotice}>
            {"Dismiss"}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const GeneralSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={"Auto-accept permissions"}
          description={"Permission requests will be automatically approved"}
        >
          <div data-action="settings-auto-accept-permissions">
            <Switch checked={accepting()} disabled={!dir()} onChange={toggleAccept} />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Terminal shell"}
          description={"Shell used by the terminal and agent tools"}
        >
          <Select
            data-action="settings-shell"
            options={shellOptions()}
            current={shellOptions().find((o) => o.value === currentShell()) ?? autoOption}
            value={(o) => o.id}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              if (option.value === currentShell()) return
              serverSync().updateConfig({ shell: option.value })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "180px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={"Show reasoning summaries"}
          description={"Display model reasoning summaries in the timeline"}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Expand shell tool parts"}
          description={"Show shell tool parts expanded by default in the timeline"}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Expand edit tool parts"}
          description={"Show edit, write, and patch tool parts expanded by default in the timeline"}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const AdvancedSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{"Advanced"}</h3>

      <SettingsList>
        <SettingsRow
          title={"File tree"}
          description={"Show the file tree panel in sessions"}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Navigation controls"}
          description={"Show the back and forward buttons in the desktop title bar"}
        >
          <div data-action="settings-show-navigation">
            <Switch
              checked={settings.general.showNavigation()}
              onChange={(checked) => settings.general.setShowNavigation(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Command palette"}
          description={"Show the search and command palette button in the title bar"}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Server status"}
          description={"Show the server status button in the title bar"}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Show agent"}
          description={"Switch between agents in the composer. When hidden, defaults to Build agent."}
        >
          <div data-action="settings-show-custom-agents">
            <Switch
              checked={settings.general.showCustomAgents()}
              onChange={(checked) => settings.general.setShowCustomAgents(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const AppearanceSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{"Appearance"}</h3>

      <SettingsList>
        <SettingsRow
          title={"Color scheme"}
          description={"Choose whether Redcode follows the system, light, or dark theme"}
        >
          <Select
            data-action="settings-color-scheme"
            options={colorSchemeOptions()}
            current={colorSchemeOptions().find((o) => o.value === theme.colorScheme())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && theme.setColorScheme(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "220px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={"Theme"}
          description={
            <>
              {"Customise how Redcode is themed."}{" "}
              <ExternalLink href="https://github.com/reddb-io/redcode">{"Learn more"}</ExternalLink>
            </>
          }
        >
          <Select
            data-action="settings-theme"
            options={themeOptions()}
            current={themeOptions().find((o) => o.id === theme.themeId())}
            value={(o) => o.id}
            label={(o) => o.name}
            onSelect={(option) => {
              if (!option) return
              theme.setTheme(option.id)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={"UI Font"}
          description={"Customise the font used throughout the interface"}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-ui-font"
              label={"UI Font"}
              hideLabel
              type="text"
              value={sans()}
              onChange={(value) => settings.appearance.setUIFont(value)}
              placeholder={sansDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Code Font"}
          description={"Customise the font used in code blocks"}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-code-font"
              label={"Code Font"}
              hideLabel
              type="text"
              value={mono()}
              onChange={(value) => settings.appearance.setFont(value)}
              placeholder={monoDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Terminal Font"}
          description={"Customise the font used in the terminal"}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-terminal-font"
              label={"Terminal Font"}
              hideLabel
              type="text"
              value={terminal()}
              onChange={(value) => settings.appearance.setTerminalFont(value)}
              placeholder={terminalDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": terminalFontFamily(settings.appearance.terminalFont()) }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const NotificationsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{"System notifications"}</h3>

      <SettingsList>
        <SettingsRow
          title={"Agent"}
          description={"Show system notification when the agent is complete or needs attention"}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Permissions"}
          description={"Show system notification when a permission is required"}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Errors"}
          description={"Show system notification when an error occurs"}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const SoundsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{"Sound effects"}</h3>

      <SettingsList>
        <SettingsRow
          title={"Agent"}
          description={"Play sound when the agent is complete or needs attention"}
        >
          <Select
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={"Permissions"}
          description={"Play sound when a permission is required"}
        >
          <Select
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={"Errors"}
          description={"Play sound when an error occurs"}
        >
          <Select
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const UpdatesSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{"Updates"}</h3>

      <SettingsList>
        <SettingsRow
          title={"Release notes"}
          description={"Show What's New popups after updates"}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={"Check for updates"}
          description={"Manually check for updates and install if available"}
        >
          <Button size="small" variant="secondary" disabled={!updater.action().run} onClick={updater.run}>
            {updaterLabels[updater.action().label] ?? updater.action().label}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const DisplaySection = () => (
    <Show when={desktop()}>
      <div class="flex flex-col gap-1">
        <h3 class="text-14-medium text-text-strong pb-2">{"Display"}</h3>

        <SettingsList>
          <SettingsRow
            title={"Pinch to zoom"}
            description={"Allow trackpad pinch and Ctrl-scroll gestures to zoom"}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.latest} onChange={onPinchZoomChange} />
            </div>
          </SettingsRow>

          <Show when={linux()}>
            <SettingsRow
              title={
                <div class="flex items-center gap-2">
                  <span>{"Use native Wayland"}</span>
                  <Tooltip value={"On Linux with mixed refresh-rate monitors, native Wayland can be more stable."} placement="top">
                    <span class="text-text-weak">
                      <Icon name="help" size="small" />
                    </span>
                  </Tooltip>
                </div>
              }
              description={"Disable X11 fallback on Wayland. Requires restart."}
            >
              <div data-action="settings-wayland">
                <Switch checked={displayBackend.latest === "wayland"} onChange={onDisplayBackendChange} />
              </div>
            </SettingsRow>
          </Show>
        </SettingsList>
      </div>
    </Show>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{"General"}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <Show when={settings.general.layoutTransitionAvailable()}>
          <InterfaceSection />
        </Show>

        <Show when={settings.general.newInterfaceNoticeVisible()}>
          <InterfaceNoticeSection />
        </Show>

        <GeneralSection />

        <AppearanceSection />

        <NotificationsSection />

        <SoundsSection />

        <UpdatesSection />

        <DisplaySection />

        <Show when={desktop()}>
          <AdvancedSection />
        </Show>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
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
