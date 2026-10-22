import { iconNames, type IconName } from "@opencode/ui/icons/provider"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import { Match, Switch } from "solid-js"
import { OpenCodeLogo } from "@/providers/opencode-logo"
import customManagedProvider from "@/providers/custom-managed-provider.svg"
import "@/settings/settings.css"

type ModelProvider = { id: string; canonical?: string; name: string }

export function CustomManagedProviderIcon(props: { class?: string }) {
  return <img data-component="custom-managed-provider-icon" src={customManagedProvider} alt="" class={props.class} />
}

export function ProviderModelIcon(props: { provider: ModelProvider; class?: string }) {
  const icon = () =>
    [
      props.provider.canonical,
      props.provider.canonical?.replace(/-token-plan$/, ""),
      props.provider.id.replace(/^console-/, ""),
    ].find((id): id is IconName => !!id && id !== "synthetic" && iconNames.includes(id as IconName))

  return (
    <Switch>
      <Match when={props.provider.id === "opencode"}>
        <OpenCodeLogo class={`size-4 ${props.class ?? ""}`} />
      </Match>
      <Match when={icon()} keyed>
        {(id) => <ProviderIcon id={id} width={16} height={16} class={props.class} />}
      </Match>
      <Match when={true}>
        <CustomManagedProviderIcon class={`size-4 ${props.class ?? ""}`} />
      </Match>
    </Switch>
  )
}
