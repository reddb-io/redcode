import { Suspense, type ParentProps } from "solid-js"
import { Titlebar } from "@/shell/titlebar/titlebar"
import { usePlatform } from "@/runtime/platform/platform"
import { ToastRegion } from "@/shell/notifications/toast"
import { UploadToastHost } from "@/composer/attachments/uploads"
import { TitlebarRightProvider } from "@/shell/titlebar/right-slot"
import { useSettingsSurface } from "@/settings/surface"
import { useSettings } from "@/settings/model"
import { ExtensionServerCover } from "@/runtime/extension/server-shell"
import { ExtensionSlot } from "@/runtime/extension/render"
import { useProjectMenuItems } from "@/runtime/extension/projects"
import { useNavigation } from "@/shell/navigation/controller"
import { useCommand } from "@/shell/commands/command"
import { AgentsMenu } from "@/shell/navigation/agents-menu"
import { navigationView } from "@/shell/navigation/view"
import { sharedSource } from "@/runtime/react/source"
import { sharedMount } from "@/runtime/react/mount"
import { ReactView } from "@/runtime/react/view"
import { Shell } from "./shell.react"

export default function Layout(props: ParentProps) {
  return (
    <TitlebarRightProvider>
      <ShellHost>{props.children}</ShellHost>
    </TitlebarRightProvider>
  )
}

/** Application services and contributed renderers retain their current scopes during migration. */
function ShellHost(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettingsSurface()
  const preferences = useSettings()
  const navigation = useNavigation()
  const command = useCommand()
  const contributions = useProjectMenuItems()
  const source = sharedSource(() => ({
    navigation: navigationView(navigation, command, contributions, platform, preferences.general.navigationLabels()),
    bottomTitlebar: navigation.mobile() && preferences.general.mobileTitlebarPosition() === "bottom",
    windows: platform.platform === "desktop" && platform.os === "windows",
    settings: settings.active(),
  }))
  const slots = {
    titlebar: sharedMount(() => <Titlebar />),
    agents: sharedMount(() => <AgentsMenu />),
    content: sharedMount(() => (
      <ExtensionServerCover>
        <Suspense>{props.children}</Suspense>
      </ExtensionServerCover>
    )),
    bottom: sharedMount(() => <ExtensionSlot at="window.bottom" input={{}} />),
    notifications: sharedMount(() => (
      <>
        <ToastRegion />
        <UploadToastHost />
      </>
    )),
  }
  return <ReactView component={Shell} props={{ source, navigation, slots }} />
}

export type ShellSnapshot = {
  navigation: ReturnType<typeof navigationView>
  bottomTitlebar: boolean
  windows: boolean
  settings: boolean
}
