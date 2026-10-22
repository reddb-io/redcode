/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { ProviderIcon } from "@/runtime/react/provider-icon.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"

export function ChatGPTNotice(props: {
  source: SharedSource<{ language: SharedLanguage; open: boolean }>
  kind: "welcome" | "usage"
  close: () => void
  manage?: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  const title = language.t(
    props.kind === "welcome" ? "provider.connect.chatgptWelcome.title" : "provider.connect.chatgptUsageLimit.title",
  )
  return (
    <Dialog
      open={view.open}
      title={title}
      description={language.t(
        props.kind === "welcome"
          ? "provider.connect.chatgptWelcome.description"
          : "provider.connect.chatgptUsageLimit.description",
      )}
      showClose={false}
      initialFocus="actions"
      className="w-[min(calc(100vw-32px),390px)] rounded-xl p-8 text-center"
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
      header={() => (
        <div className="flex flex-col items-center gap-6">
          <ProviderIcon provider="openai" className="size-12 text-v2-icon-icon-base" />
          <span className="max-w-[270px] text-[20px] font-[530] leading-7 tracking-[-0.3px] text-v2-text-text-base">
            <bdi dir="auto">{title}</bdi>
          </span>
        </div>
      )}
      actions={() => (
        <div className="mt-8 flex w-full flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={props.kind === "welcome" ? props.close : props.manage}
          >
            {language.t(
              props.kind === "welcome"
                ? "provider.connect.chatgptWelcome.confirm"
                : "provider.connect.chatgptUsageLimit.manage",
            )}
          </Button>
          {props.kind === "usage" && (
            <Button variant="ghost" size="lg" className="w-full" onClick={props.close}>
              {language.t("provider.connect.chatgptUsageLimit.close")}
            </Button>
          )}
        </div>
      )}
    >
      {props.kind === "welcome" && (
        <>
          <a
            href="https://chatgpt.com/settings/usage"
            target="_blank"
            rel="noopener noreferrer"
            dir="auto"
            className="mt-1 block rounded-sm text-[13px] leading-5 text-v2-text-text-muted underline-offset-2 hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-2"
          >
            {language.t("provider.connect.chatgptWelcome.usage")}
          </a>
        </>
      )}
    </Dialog>
  )
}
