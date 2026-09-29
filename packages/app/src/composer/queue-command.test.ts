import { describe, expect, test } from "bun:test"
import type { Prompt } from "./state"
import { stripQueueCommand } from "./queue-command"

describe("stripQueueCommand", () => {
  test("strips /queue and moves the parts after it back by its length", () => {
    const image = {
      type: "image" as const,
      id: "1",
      filename: "img.png",
      mime: "image/png",
      blob: { id: "blob", url: "blob:test" },
    }
    const prompt: Prompt = [
      { type: "text", content: "/queue fix ", start: 0, end: 11 },
      { type: "agent", content: "@build", start: 11, end: 17, name: "build" },
      { type: "text", content: " now", start: 17, end: 21 },
      image,
    ]

    expect(stripQueueCommand(prompt)).toEqual([
      { type: "text", content: "fix ", start: 0, end: 4 },
      { type: "agent", content: "@build", start: 4, end: 10, name: "build" },
      { type: "text", content: " now", start: 10, end: 14 },
      image,
    ])
  })

  test("drops a text part that held only the command", () => {
    const prompt: Prompt = [
      { type: "text", content: "/queue ", start: 0, end: 7 },
      { type: "agent", content: "@build", start: 7, end: 13, name: "build" },
    ]

    expect(stripQueueCommand(prompt)).toEqual([{ type: "agent", content: "@build", start: 0, end: 6, name: "build" }])
  })

  test("reads only a leading /queue command", () => {
    const text = (content: string): Prompt => [{ type: "text", content, start: 0, end: content.length }]

    expect(stripQueueCommand(text("/queue"))).toEqual([])
    expect(stripQueueCommand(text("/queued work"))).toBeUndefined()
    expect(stripQueueCommand(text("please /queue this"))).toBeUndefined()
  })
})
