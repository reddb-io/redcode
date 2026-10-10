import { Option, Schema } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceLabel } from "@opencode/util/intelligence-label"
import { createMemo, createResource, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { errorStatus } from "@/shell/errors/description"
import { showToast } from "@/shell/notifications/toast"

/** A session's reasoning mode choice: one of the modes, or `default` for the service's own. */
export type ReasoningChoice = Intelligence.Reasoning | "default"

const decodeReasoning = Schema.decodeUnknownOption(Intelligence.Reasoning)

/**
 * The reasoning mode of the composer's session and what S1 says about it, read like the TUI footer: the scoped status
 * (effective mode and its source), the latest evaluation while the session runs dual, and a minute's refresh.
 *
 * A session that does not exist yet keeps its choice here and `apply` sets it once the session is created, before its
 * first prompt is admitted; the server can only scope a mode to an existing session.
 */
export function createComposerReasoning(input: { session: Accessor<string | undefined> }) {
  const server = useServerSDK()
  const data = useData()
  const language = useLanguage()
  const [state, setState] = createStore<{ tick: number; draft: ReasoningChoice }>({ tick: 0, draft: "default" })
  // S1 settles evaluations as the session works; the TUI footer refreshes on the same cadence.
  const timer = setInterval(() => setState("tick", (value) => value + 1), 60_000)
  onCleanup(() => clearInterval(timer))

  const override = createMemo<ReasoningChoice>(() => {
    const id = input.session()

    if (!id) return state.draft

    return Option.getOrElse(decodeReasoning(data.session.get(id)?.metadata?.reasoning), () => "default" as const)
  })

  // The override is part of the key, so a mode change made anywhere reads the new effective mode.
  const [status, statusActions] = createResource(
    () => ({ sessionID: input.session(), override: override(), tick: state.tick }),
    (key) => server.api["server.intelligence"].status({ sessionID: key.sessionID }),
  )
  // Reading an unresolved resource would suspend the composer, so only settled values are read.
  const current = () => (status.state === "ready" || status.state === "refreshing" ? status.latest : undefined)
  // A server without the experimental reasoning API answers 404: the feature is absent there, not offline.
  const unsupported = () => status.state === "errored" && errorStatus(status.error) === 404
  const failed = () => status.state === "errored" && !unsupported()

  const mode = createMemo<Intelligence.Reasoning | undefined>(() => {
    const choice = override()

    if (!input.session() && choice !== "default") return choice

    return current()?.effective.reasoning
  })

  const [history] = createResource(
    () => {
      const id = input.session()

      return id && mode() === "dual" ? { sessionID: id, state: data.session.status(id), tick: state.tick } : false
    },
    (key) => server.api["server.intelligence"].history({ sessionID: key.sessionID, limit: 1 }),
  )

  const outcome = () =>
    IntelligenceLabel.outcome({
      mode: mode(),
      historyFailed: history.state === "errored",
      decision: history.state === "ready" ? history.latest?.[0]?.decision : undefined,
    })

  const sessionMode = (sessionID: string, choice: ReasoningChoice) =>
    server.api["server.intelligence"]
      .sessionMode({ sessionID, reasoning: choice === "default" ? null : choice })
      .then(() => {
        void statusActions.refetch()
      })

  return {
    /** The session the mode belongs to; undefined until a draft's session is created. */
    session: input.session,
    /** The scoped status, once read. */
    status: current,
    /** The server has no reasoning API, so nothing about reasoning is shown. */
    unsupported,
    /** The effective mode: the draft's choice before creation, else the server's for this session. */
    mode,
    /** The session's own choice; `default` follows the service. */
    override,
    /** The session does not exist yet, so a choice waits for `apply`. */
    draft: () => !input.session(),
    /** What the S1 indicator says, if anything. */
    state: () =>
      IntelligenceLabel.state({
        failed: failed(),
        onboarding: current()?.settings.onboarding,
        mode: mode(),
        outcome: outcome(),
      }),
    tone: () => IntelligenceLabel.tone({ failed: failed(), outcome: outcome() }),
    /** Sets the session's mode, or keeps the draft's choice until the session exists. */
    set(choice: ReasoningChoice) {
      const id = input.session()

      if (!id) return setState("draft", choice)
      void sessionMode(id, choice).catch((error: unknown) => {
        showToast({
          variant: "error",
          title: language.t("composer.reasoning.failed"),
          description: formatServerError(error, language.t, language.t("common.requestFailed")),
        })
      })
    },
    /** Sets a draft's choice before prompting; a failure rejects so the prompt keeps the chosen mode. */
    apply(sessionID: string) {
      const choice = state.draft

      if (choice === "default") return Promise.resolve()

      return sessionMode(sessionID, choice)
    },
  }
}

export type ComposerReasoning = ReturnType<typeof createComposerReasoning>
