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

  test("reads the innermost provider message out of nested JSON error bodies", () => {
    const upstream = JSON.stringify({
      error: {
        type: "server_error",
        message:
          "Upstream request failed: This Go model requires Global regions. Select Global in your workspace's Privacy settings to use it.",
      },
    })
    const body = JSON.stringify({
      error: { message: `[400]: ${upstream}`, type: "invalid_request_error", param: null, code: "bad_request" },
    })
    const reason = `RequestExecutor.execute: Provider request failed with HTTP 400: ${body}`
    const expected =
      "Generative connection failed (HTTP 400): Upstream request failed: This Go model requires Global regions. Select Global in your workspace's Privacy settings to use it."
    expect(Semantic.probeVerdict(Result.fail(new Error(reason)))).toEqual({ ok: false, message: expected })
    expect(Semantic.probeVerdict(Result.succeed([LLMEvent.providerError({ message: reason })]))).toEqual({
      ok: false,
      message: expected,
    })
  })

  test("keeps plain provider text and the HTTP status when there is no JSON body", () => {
    expect(
      Semantic.probeVerdict(Result.fail(new Error("Provider request failed with HTTP 429: Rate limit exceeded"))).message,
    ).toBe("Generative connection failed (HTTP 429): Rate limit exceeded")
    expect(Semantic.probeVerdict(Result.fail(new Error("Provider request failed with HTTP 503"))).message).toBe(
      "Generative connection failed (HTTP 503): the provider rejected the request",
    )
    expect(Semantic.probeVerdict(Result.fail(new Error("Model [beta] is not available"))).message).toBe(
      "Generative connection failed: Model [beta] is not available",
    )
  })
})
