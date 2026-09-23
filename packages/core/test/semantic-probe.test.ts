import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { LLMEvent } from "@reddb-io/redcode-llm"
import { Semantic } from "../src/semantic"

const finish = (reason: "stop" | "length" | "error" | "content-filter") => LLMEvent.finish({ reason })

describe("Semantic.probeVerdict", () => {
  test("a reasoning model that stops at the length limit without text is a working connection", () => {
    const verdict = Semantic.probeVerdict(
      Result.succeed([LLMEvent.reasoningDelta({ id: "r", text: "thinking" }), finish("length")]),
    )
    expect(verdict).toEqual({ ok: true, message: "Generative connection checked" })
  })

  test("a plain answer is a working connection", () => {
    expect(Semantic.probeVerdict(Result.succeed([LLMEvent.textDelta({ id: "t", text: "OK" }), finish("stop")])).ok).toBe(
      true,
    )
  })

  test("never reports a failed connection as checked", () => {
    const failures = [
      Semantic.probeVerdict(Result.fail(new Error("401 Unauthorized"))),
      Semantic.probeVerdict(Result.succeed([LLMEvent.providerError({ message: "model not found" })])),
      Semantic.probeVerdict(Result.succeed([LLMEvent.textDelta({ id: "t", text: "OK" })])),
      Semantic.probeVerdict(Result.succeed([finish("error")])),
      Semantic.probeVerdict(Result.succeed([finish("content-filter")])),
    ]
    for (const verdict of failures) {
      expect(verdict.ok).toBe(false)
      expect(verdict.message).toStartWith("Generative connection failed")
    }
    expect(failures[0]?.message).toContain("401 Unauthorized")
    expect(failures[1]?.message).toContain("model not found")
  })
})
