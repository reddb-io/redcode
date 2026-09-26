import { SettingsIntelligence } from "./settings-intelligence"
import { Component, createSignal, startTransition } from "solid-js"
import { Dialog } from "@reddb-io/redcode-ui/dialog"
import { Tabs } from "@reddb-io/redcode-ui/tabs"
import { Icon } from "@reddb-io/redcode-ui/icon"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsServers } from "./settings-servers"

export const DialogSettings: Component<{ defaultValue?: string }> = (props) => {
  const platform = usePlatform()
  const dialog = useDialog()
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")

  const showProviders = () => {
    void dialog.show(() => <DialogSettings defaultValue="providers" />)
  }

  return (
    <Dialog size="x-large" transition>
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="h-full settings-dialog"
      >
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full gap-4">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{"Desktop"}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {"General"}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {"Shortcuts"}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="servers">
                      <Icon name="server" />
                      {"Servers"}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{"Server"}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {"Providers"}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="intelligence">
                      <Icon name="models" />
                      {"Intelligence"}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {"Models"}
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{"Redcode Desktop"}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="servers" class="no-scrollbar">
          <SettingsServers />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders onBack={showProviders} />
        </Tabs.Content>
        <Tabs.Content value="intelligence" class="no-scrollbar">
          <SettingsIntelligence />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
