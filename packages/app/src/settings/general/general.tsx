import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { sharedMount } from "@/runtime/react/mount"
import { ExtensionSettingsSections } from "@/runtime/extension/settings-page-view"
import { DialogHttpsAccess } from "@/servers/connect/https-dialog"
import { useSettings } from "../model"
import { settingsLanguage } from "../shared.react"
import { General } from "./view.react"

export function SettingsGeneral() {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const dialog = useDialog()
  const services = {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      locales: language.locales.map((value) => ({ value, label: language.label(value) })),
      values: {
        showNavigation: settings.general.showNavigation(),
        navigationGap: settings.general.navigationGap(),
        workspaceDestination: settings.workspaces.defaultDestination(),
        autoApprove: settings.permissions.autoApprove(),
        showAgent: settings.general.showAgent(),
        terminalPlacement: settings.general.terminalPlacement(),
        followUpBehavior: settings.general.followUpBehavior(),
        mobileTitlebarPosition: settings.general.mobileTitlebarPosition(),
        timelineDetail: Object.fromEntries(
          Object.entries(settings.general.timelineDetail()).map(([key, value]) => [key, { ...value }]),
        ) as ReturnType<typeof settings.general.timelineDetail>,
      },
      installation: platform.installation
        ? {
            status: platform.installation.status(),
            failed: platform.installation.failed(),
            pending: platform.installation.pending(),
          }
        : undefined,
    })),
    settings,
    platform,
    setLocale: language.setLocale,
    https: () => void dialog.push(() => <DialogHttpsAccess />),
    generalSections: sharedMount(() => <ExtensionSettingsSections page="general" section="general" />),
    sections: sharedMount(() => <ExtensionSettingsSections page="general" />),
  }
  return <ReactView component={General} props={{ services }} />
}
