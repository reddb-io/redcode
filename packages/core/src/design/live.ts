export * as DesignLive from "./live.js"

import { Design } from "@opencode/schema/design"
import { Effect } from "effect"
import { Intelligence } from "../intelligence.js"
import { Voice } from "../voice.js"

/**
 * What a live deck asks of the user's own Redcode connections, so its files never hold a key: System One answers
 * typed questions about a text, and dictation transcribes a recording. Each needs its grant on the design.
 */
export const decide = Effect.fn("DesignLive.decide")(function* (document: Design.Info, input: Design.LiveDecide) {
  if (!document.live?.systemOne) return yield* refused("System One")
  const intelligence = yield* Intelligence.Service
  const response = yield* intelligence
    .ask(input.text, input.questions)
    .pipe(Effect.mapError((error) => new Design.Error({ code: "unavailable", message: error.message })))
  return { answers: response.answers }
})

export const transcribe = Effect.fn("DesignLive.transcribe")(function* (
  document: Design.Info,
  input: Design.LiveTranscribe,
) {
  if (!document.live?.transcription) return yield* refused("transcription")
  const voice = yield* Voice.Service
  const text = yield* voice.transcribe(input.audio).pipe(
    Effect.mapError(
      (error) =>
        new Design.Error({ code: error._tag === "Voice.Invalid" ? "invalid" : "unavailable", message: error.message }),
    ),
  )
  return { text }
})

function refused(capability: string) {
  return new Design.Error({
    code: "invalid",
    message: `This design was not granted ${capability}; ask for it with design_document live`,
  })
}
