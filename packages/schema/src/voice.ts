export * as Voice from "./voice.js"

import { Schema } from "effect"
import { Connection } from "./connection.js"
import { Credential } from "./credential.js"
import { IntegrationID } from "./integration-id.js"

export const SavedConnection = Schema.Struct({
  id: Credential.ID,
  label: Schema.String,
  integrationID: IntegrationID,
}).annotate({ identifier: "Voice.SavedConnection" })
export type SavedConnection = typeof SavedConnection.Type

export const ConnectInput = Schema.Struct({
  label: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
}).annotate({ identifier: "Voice.ConnectInput" })
export type ConnectInput = typeof ConnectInput.Type

export const Settings = Schema.Struct({
  provider: Schema.Literals(["openai", "openrouter", "elevenlabs", "deepgram", "openai-compatible"]),
  mode: Schema.optionalKey(Schema.Literals(["batch", "realtime"])),
  model: Schema.NonEmptyString,
  connection: Schema.optionalKey(Connection.Ref),
  baseURL: Schema.optionalKey(Schema.String),
  language: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Voice.Settings" })
export type Settings = typeof Settings.Type

export const ModelsInput = Schema.Struct({
  provider: Settings.fields.provider,
  connection: Schema.optionalKey(Connection.Ref),
  baseURL: Schema.optionalKey(Schema.String),
})
export const Model = Schema.Struct({ id: Schema.String, name: Schema.String })

export const RealtimeAccess = Schema.Struct({
  token: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  language: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Voice.RealtimeAccess" })
export type RealtimeAccess = typeof RealtimeAccess.Type

// Five minutes of 16 kHz mono PCM, plus its WAV header, encoded as base64.
export const MaxAudioBytes = 9_600_044
export const Audio = Schema.String.pipe(Schema.check(Schema.isMaxLength(12_800_060)))
