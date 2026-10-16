import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Config } from "@opencode/schema/config"
import { Model } from "@opencode/schema/model"
import { Prompt } from "@opencode/schema/prompt"
import { Session } from "@opencode/schema/session"
import { SessionObservation } from "@opencode/schema/session-observation"
import { WorkerLease } from "@opencode/schema/worker-lease"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { SessionMessage } from "@opencode/schema/session-message"
import { Vcs } from "@opencode/schema/vcs"

const Client = await import("../src/effect")

test("effect entrypoint exposes canonical Schema contracts", () => {
  expect(Client.Agent).toBe(Agent)
  expect(Client.Config).toBe(Config)
  expect(Client.Model).toBe(Model)
  expect(Client.Session).toBe(Session)
  expect(Client.SessionObservation.Info).toBe(SessionObservation.Info)
  expect(Client.WorkerLease.Info).toBe(WorkerLease.Info)
  expect(Client.ProjectEnvironment.Recipe).toBe(ProjectEnvironment.Recipe)
  expect(Client.Vcs.Base).toBe(Vcs.Base)
})

test("generated Effect API names canonical and composed outputs", async () => {
  const source = await Bun.file(new URL("../src/effect/api/api.ts", import.meta.url)).text()

  expect(source).toContain("export type SessionGetOutput = Session.Info")
  expect(source).toContain("export type SessionObservationOutput = SessionObservation.Info")
  expect(source).toContain("export type EventSubscribeOutput = OpenCodeEvent")
  expect(source).not.toContain("HttpApiClient.ForApi")
})

test("shared DTO schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
  const observation = SessionObservation.Info.make({
    sessionID: "ses_receipt",
    messageID: "msg_receipt",
    directory: "/checkout",
    admission: "pending",
    execution: "idle",
    pending: true,
    waiting: false,
    outcome: undefined,
  })
  expect(Schema.encodeSync(SessionObservation.Info)(observation)).not.toHaveProperty("outcome")
  expect(SessionObservation.Info.ast.annotations?.identifier).toBe("SessionObservation.Info")
})
