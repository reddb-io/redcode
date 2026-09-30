import type { SessionMessageUser } from "@opencode/client/promise"
import { Vault } from "@opencode/schema/vault"
import { Button } from "@opencode/ui/button"
import { Option, Schema } from "effect"
import { createEffect, createMemo, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useServerSDK } from "@/runtime/server/client"

const decodeMoved = Schema.decodeUnknownOption(Vault.Moved)
const decodeRestricted = Schema.decodeUnknownOption(Vault.Restricted)

/** The restricted messages of a Session, from its `metadata.restricted` marker. */
export const restrictedMessages = (metadata: Record<string, unknown> | undefined) =>
  Option.getOrElse(decodeRestricted(metadata?.restricted), (): Vault.Restricted => ({}))

/**
 * The dim lines under a user message: what the vault replaced, and whether System One marked the message as
 * restricted, with the user's own action to remove it from the context. Neither line claims the provider never saw it.
 */
export function RestrictedNotice(props: {
  message: SessionMessageUser
  sessionID: string
  directory: string
  metadata: Accessor<Record<string, unknown> | undefined>
}) {
  const language = useLanguage()
  const server = useServerSDK()
  const moved = createMemo(() => Option.getOrElse(decodeMoved(props.message.metadata?.vault), () => []))
  const state = createMemo(() => restrictedMessages(props.metadata())[props.message.id])
  const withhold = () =>
    server.api.rpc
      .call({
        rpcID: Vault.Definition.id,
        method: "withhold",
        input: { sessionID: props.sessionID, messageID: props.message.id },
        location: { directory: props.directory },
      })
      .catch((cause: unknown) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : undefined,
        }),
      )
  const confirm = () =>
    showToast({
      title: language.t("session.restricted.confirm.title"),
      description: language.t("session.restricted.confirm.description", { placeholder: Vault.WITHHELD }),
      persistent: true,
      actions: [
        { label: language.t("session.restricted.remove"), onClick: () => void withhold() },
        { label: language.t("common.cancel"), onClick: "dismiss" },
      ],
    })

  return (
    <Show when={moved().length > 0 || state()}>
      <div data-component="session-message-restricted" class="mt-1 flex min-w-0 flex-col items-start gap-1">
        <Show when={moved().length > 0}>
          <p class="text-12-regular text-v2-text-text-muted">
            {language.plural("session.vault.moved", moved().length, {
              references: moved()
                .map((item) => Vault.reference(item.name))
                .join(", "),
            })}
          </p>
        </Show>
        <Show when={state() === "sensitive"}>
          <p class="text-12-regular text-v2-text-text-muted">{language.t("session.restricted.sensitive")}</p>
          <Button type="button" variant="ghost-faint" size="small" onClick={confirm}>
            {language.t("session.restricted.remove")}
          </Button>
        </Show>
        <Show when={state() === "withheld"}>
          <p class="text-12-regular text-v2-text-text-muted">
            {language.t("session.restricted.withheld", { placeholder: Vault.WITHHELD })}
          </p>
        </Show>
      </div>
    </Show>
  )
}

/**
 * Announces a System One flag once, when it lands while the Session is open. The flags a Session already had when it
 * was first seen here only keep their line.
 */
export function announceRestricted(
  session: Accessor<{ readonly id: string; readonly metadata?: Record<string, unknown> } | undefined>,
) {
  const language = useLanguage()
  const seen = new Map<string, ReadonlySet<string>>()
  createEffect(() => {
    const current = session()
    if (!current) return
    const known = seen.get(current.id)
    const flagged = Object.entries(restrictedMessages(current.metadata)).flatMap(([messageID, value]) =>
      value === "sensitive" ? [messageID] : [],
    )
    seen.set(current.id, new Set([...(known ?? []), ...flagged]))
    if (known && flagged.some((messageID) => !known.has(messageID)))
      showToast({ description: language.t("session.restricted.sensitive"), duration: 12_000 })
  })
}
