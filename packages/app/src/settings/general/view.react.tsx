/** @jsxImportSource react */
import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Select } from "@reddb-io/design-system/base/Select"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { Slider } from "@reddb-io/design-system/base/Slider"
import { SettingsHeader, SettingsList, SettingsRow } from "../shared.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import { formatKeybind } from "@/shell/commands/keys"
import { TimelineDetailControl } from "../timeline-detail.react"
import type { SharedSource } from "@/runtime/react/source"
import type { useSettings } from "../model"
import type { usePlatform } from "@/runtime/platform/platform"
import type { useLanguage } from "@/runtime/i18n/language"
import type { SettingsLanguage } from "../shared.react"
import type { SharedMount } from "@/runtime/react/mount"

type Settings = ReturnType<typeof useSettings>
type Platform = ReturnType<typeof usePlatform>
const installationDescriptions = {
  available: "settings.general.install.description",
  installed: "settings.general.install.installedDescription",
  insecure: "settings.general.install.insecure",
  manual: "settings.general.install.manual",
} as const

export function General(props: {
  services: {
    snapshot: SharedSource<{
      language: SettingsLanguage
      locales: { value: ReturnType<typeof useLanguage>["locales"][number]; label: string }[]
      values: {
        showNavigation: boolean
        navigationGap: number
        autoApprove: boolean
        showAgent: boolean
        workspaceDestination: ReturnType<Settings["workspaces"]["defaultDestination"]>
        terminalPlacement: ReturnType<Settings["general"]["terminalPlacement"]>
        followUpBehavior: ReturnType<Settings["general"]["followUpBehavior"]>
        mobileTitlebarPosition: "top" | "bottom"
        timelineDetail: ReturnType<Settings["general"]["timelineDetail"]>
      }
      installation?: { status: keyof typeof installationDescriptions; failed: boolean; pending: boolean }
    }>
    settings: Settings
    platform: Platform
    setLocale: ReturnType<typeof useLanguage>["setLocale"]
    https: () => void
    generalSections: SharedMount
    sections: SharedMount
  }
}) {
  const services = props.services
  const state = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = state.language
  const settings = services.settings
  const values = state.values
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 767px)").matches)
  const [pinchZoom, setPinchZoom] = useState(false)
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)")
    const update = () => setMobile(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    if (services.platform.platform !== "desktop") return
    const state = { mounted: true }
    void Promise.resolve(services.platform.getPinchZoomEnabled?.() ?? false)
      .catch(() => false)
      .then((value) => {
        if (state.mounted) setPinchZoom(value)
      })
    return () => {
      state.mounted = false
    }
  }, [services])
  const installation = state.installation
  return (
    <>
      <SettingsHeader
        title={language.t("settings.tab.preferences")}
        description={language.t("settings.preferences.description")}
      />
      <div className="settings-tab-body settings-tab-body--sectioned">
        <div className="settings-section">
          <h3 className="settings-section-title">{language.t("settings.general.section.general")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.general.row.language.title")}
              description={language.t("settings.general.row.language.description")}
            >
              {(association) => (
                <Select
                  {...association}
                  data-action="settings-language"
                  controlSize="sm"
                  options={state.locales}
                  value={language.locale}
                  onValueChange={(value) => {
                    const option = state.locales.find((item) => item.value === value)
                    if (option) services.setLocale(option.value)
                  }}
                />
              )}
            </SettingsRow>
            <SettingsRow title={language.t("https.title")} description={language.t("https.description")}>
              {(association) => (
                <Button
                  {...association}
                  aria-labelledby={undefined}
                  data-action="settings-https-access"
                  variant="secondary"
                  size="sm"
                  onClick={services.https}
                >
                  {language.t("https.configure")}
                </Button>
              )}
            </SettingsRow>
            {installation && (
              <SettingsRow
                title={language.t("settings.general.install.title")}
                description={language.t(
                  installation.failed
                    ? "settings.general.install.failed"
                    : installationDescriptions[installation.status],
                )}
              >
                {(association) => (
                  <div data-action="settings-install-app" aria-live="polite">
                    {installation.status === "insecure" && (
                      <Button
                        {...association}
                        aria-labelledby={undefined}
                        variant="secondary"
                        size="sm"
                        onClick={services.https}
                      >
                        {language.t("https.secureConnection")}
                      </Button>
                    )}
                    {(installation.status === "available" || installation.pending) && (
                      <Button
                        {...association}
                        aria-labelledby={undefined}
                        variant="secondary"
                        size="sm"
                        disabled={installation.pending}
                        onClick={() => services.platform.installation?.install()}
                      >
                        {language.t(
                          installation.pending ? "settings.general.install.pending" : "settings.general.install.action",
                        )}
                      </Button>
                    )}
                    {installation.status === "installed" && (
                      <span>{language.t("settings.general.install.installed")}</span>
                    )}
                  </div>
                )}
              </SettingsRow>
            )}
            <SettingsRow
              title={language.t("settings.general.row.showNavigation.title")}
              description={language.t("settings.general.row.showNavigation.description")}
            >
              {(association) => (
                <Switch
                  {...association}
                  data-action="settings-show-navigation"
                  label={language.t("settings.general.row.showNavigation.title")}
                  fieldClass="settings-react-switch"
                  checked={values.showNavigation}
                  onCheckedChange={settings.general.setShowNavigation}
                />
              )}
            </SettingsRow>
            {!mobile && (
              <SettingsRow
                title={language.t("settings.general.row.navigationGap.title")}
                description={language.t("settings.general.row.navigationGap.description")}
              >
                {(association) => (
                  <Slider
                    {...association}
                    label={language.t("settings.general.row.navigationGap.title")}
                    value={values.navigationGap}
                    min={0}
                    max={16}
                    step={1}
                    fieldClass="w-40 [&>label]:sr-only"
                    formatValue={(value) => language.t("settings.general.row.navigationGap.value", { value })}
                    onValueChange={settings.general.setNavigationGap}
                  />
                )}
              </SettingsRow>
            )}
            <SettingsRow
              title={language.t("settings.workspaces.default.title")}
              description={language.t("settings.workspaces.default.description")}
            >
              {(association) => (
                <Select
                  {...association}
                  data-action="settings-workspace-destination"
                  controlSize="sm"
                  value={values.workspaceDestination}
                  options={(["last-used", "local", "new"] as const).map((value) => ({
                    value,
                    label: language.t(
                      value === "last-used"
                        ? "settings.workspaces.default.lastUsed"
                        : value === "local"
                          ? "settings.workspaces.default.local"
                          : "settings.workspaces.default.new",
                    ),
                  }))}
                  onValueChange={(value) => {
                    if (value === "last-used" || value === "local" || value === "new")
                      settings.workspaces.setDefaultDestination(value)
                  }}
                />
              )}
            </SettingsRow>
            <SettingsRow
              title={language.t("command.permissions.autoaccept.enable")}
              description={language.t("toast.permissions.autoaccept.on.description")}
            >
              {(association) => (
                <Switch
                  {...association}
                  data-action="settings-auto-accept-permissions"
                  label={language.t("command.permissions.autoaccept.enable")}
                  fieldClass="settings-react-switch"
                  checked={values.autoApprove}
                  onCheckedChange={settings.permissions.setAutoApprove}
                />
              )}
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.general.row.showCustomAgents.title")}
              description={language.t("settings.general.row.showCustomAgents.description")}
            >
              {(association) => (
                <Switch
                  {...association}
                  data-action="settings-show-custom-agents"
                  label={language.t("settings.general.row.showCustomAgents.title")}
                  fieldClass="settings-react-switch"
                  checked={values.showAgent}
                  onCheckedChange={settings.general.setShowAgent}
                />
              )}
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.general.row.terminalPlacement.title")}
              description={language.t("settings.general.row.terminalPlacement.description")}
            >
              {(association) => (
                <Select
                  {...association}
                  data-action="settings-terminal-placement"
                  controlSize="sm"
                  value={values.terminalPlacement}
                  options={(["side", "bottom"] as const).map((value) => ({
                    value,
                    label: language.t(`settings.general.row.terminalPlacement.${value}`),
                  }))}
                  onValueChange={(value) => {
                    if (value === "side" || value === "bottom") settings.general.setTerminalPlacement(value)
                  }}
                />
              )}
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.general.row.followUpBehavior.title")}
              description={language.t("settings.general.row.followUpBehavior.description", {
                keybind: formatKeybind("mod+enter", language.t),
              })}
            >
              {(association) => (
                <Select
                  {...association}
                  data-action="settings-follow-up-behavior"
                  controlSize="sm"
                  value={values.followUpBehavior}
                  options={(["queue", "steer"] as const).map((value) => ({
                    value,
                    label: language.t(`settings.general.row.followUpBehavior.${value}`),
                  }))}
                  onValueChange={(value) => {
                    if (value === "queue" || value === "steer") settings.general.setFollowUpBehavior(value)
                  }}
                />
              )}
            </SettingsRow>
            {services.platform.platform === "desktop" && (
              <SettingsRow
                title={language.t("settings.general.row.pinchZoom.title")}
                description={language.t("settings.general.row.pinchZoom.description")}
              >
                {(association) => (
                  <Switch
                    {...association}
                    data-action="settings-pinch-zoom"
                    label={language.t("settings.general.row.pinchZoom.title")}
                    fieldClass="settings-react-switch"
                    checked={pinchZoom}
                    onCheckedChange={(checked) => {
                      setPinchZoom(checked)
                      void Promise.resolve(services.platform.setPinchZoomEnabled?.(checked)).catch(() =>
                        setPinchZoom(!checked),
                      )
                    }}
                  />
                )}
              </SettingsRow>
            )}
            <SharedSlot mount={services.generalSections} />
            {mobile && (
              <SettingsRow
                title={language.t("settings.general.row.mobileTitlebarBottom.title")}
                description={language.t("settings.general.row.mobileTitlebarBottom.description")}
              >
                {(association) => (
                  <Switch
                    {...association}
                    data-action="settings-mobile-titlebar-bottom"
                    label={language.t("settings.general.row.mobileTitlebarBottom.title")}
                    fieldClass="settings-react-switch"
                    checked={values.mobileTitlebarPosition === "bottom"}
                    onCheckedChange={(checked) =>
                      settings.general.setMobileTitlebarPosition(checked ? "bottom" : "top")
                    }
                  />
                )}
              </SettingsRow>
            )}
          </SettingsList>
        </div>
        <section className="settings-section" aria-label={language.t("settings.timeline.title")}>
          <h3 className="settings-section-title">{language.t("settings.timeline.title")}</h3>
          <SettingsList>
            <div className="py-5">
              <TimelineDetailControl
                language={language}
                value={values.timelineDetail}
                onChange={settings.general.setTimelineDetail}
              />
            </div>
          </SettingsList>
        </section>
        <SharedSlot mount={services.sections} />
      </div>
    </>
  )
}
