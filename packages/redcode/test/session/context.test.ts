import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { SessionContext } from "../../src/session/context"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_context_interleave")
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }

function user(created: number, text: string): SessionV1.WithParts & { info: SessionV1.User } {
  const id = MessageID.ascending()
  return {
    info: { id, sessionID, role: "user", agent: "build", model, time: { created } },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text", text }],
  }
}

function assistant(created: number, parentID: MessageID, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      parentID,
      mode: "build",
      agent: "build",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.modelID,
      providerID: model.providerID,
      time: { created },
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text", text }],
  }
}

const update = (at: number, text: string) => ({ timeCreated: DateTime.makeUnsafe(at), text })

const texts = (messages: SessionV1.WithParts[]) =>
  messages.map((message) => {
    const part = message.parts[0]
    return part?.type === "text" ? part.text : ""
  })

describe("SessionContext.interleave", () => {
  test("an update older than every message goes ahead of the history", () => {
    const first = user(1_000, "first")
    const reply = assistant(1_100, first.info.id, "reply")
    const second = user(2_000, "second")

    const result = texts(SessionContext.interleave([first, reply, second], [update(500, "early")], second.info))

    expect(result).toEqual(["<system_update>\nearly\n</system_update>", "first", "reply", "second"])
  })

  test("an update admitted in the same instant as a message follows that message", () => {
    const first = user(1_000, "first")
    const reply = assistant(1_100, first.info.id, "reply")

    const result = texts(SessionContext.interleave([first, reply], [update(1_100, "same instant")], first.info))

    expect(result).toEqual(["first", "reply", "<system_update>\nsame instant\n</system_update>"])
  })

  test("an update admitted during the turn never lands ahead of the user message that started it", () => {
    // History after a compaction is not chronological: the summary comes first and a retained
    // tail with older timestamps follows it. The anchor is the turn's user message, by identity.
    const summaryUser = user(3_000, "compaction")
    const summary = assistant(3_100, summaryUser.info.id, "summary")
    const retained = assistant(1_000, summaryUser.info.id, "old retained tail")
    const turn = user(4_000, "next")
    const reply = assistant(4_100, turn.info.id, "reply")

    const result = texts(
      SessionContext.interleave([summaryUser, summary, retained, turn, reply], [update(4_050, "mid-turn")], turn.info),
    )

    expect(result).toEqual([
      "compaction",
      "summary",
      "old retained tail",
      "next",
      "<system_update>\nmid-turn\n</system_update>",
      "reply",
    ])
  })

  test("a newer message ahead of the turn's user message does not pull an update in front of it", () => {
    // A timestamp scan that stops at the first message older than the admission and followed by
    // a newer one would put the update after `older`, ahead of the user message that started
    // the turn. The anchor is the user message itself.
    const older = user(1_000, "older")
    const newer = assistant(3_000, older.info.id, "newer")
    const turn = user(2_000, "turn")
    const reply = assistant(2_100, turn.info.id, "reply")

    const result = texts(SessionContext.interleave([older, newer, turn, reply], [update(2_050, "mid-turn")], turn.info))

    expect(result).toEqual(["older", "newer", "turn", "<system_update>\nmid-turn\n</system_update>", "reply"])
  })

  test("a steered user message keeps updates on the correct side of it", () => {
    const first = user(1_000, "first")
    const reply = assistant(1_100, first.info.id, "reply")
    const steer = user(1_300, "steer")
    const later = assistant(1_400, steer.info.id, "later")

    const result = texts(
      SessionContext.interleave(
        [first, reply, steer, later],
        [update(1_200, "before the steer"), update(1_350, "after the steer")],
        steer.info,
      ),
    )

    expect(result).toEqual([
      "first",
      "reply",
      "<system_update>\nbefore the steer\n</system_update>",
      "steer",
      "<system_update>\nafter the steer\n</system_update>",
      "later",
    ])
  })
})
