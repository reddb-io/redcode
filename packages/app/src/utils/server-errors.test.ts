import { describe, expect, test } from "bun:test"
import type { SessionNotFoundError } from "@reddb-io/redcode-sdk/v2/client"
import type { ConfigInvalidError, ProviderModelNotFoundError } from "./server-errors"
import { formatServerError, isSessionNotFoundError, parseReadableConfigInvalidError } from "./server-errors"

describe("parseReadableConfigInvalidError", () => {
  test("formats issues with file path", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "opencode.config.ts",
        issues: [
          { path: ["settings", "host"], message: "Required" },
          { path: ["mode"], message: "Invalid" },
        ],
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error)

    expect(result).toBe(
      ["Config file at opencode.config.ts is invalid: settings.host: Required", "mode: Invalid"].join("\n"),
    )
  })

  test("uses trimmed message when issues are missing", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "config",
        message: "  Bad value  ",
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error)

    expect(result).toBe("Config file at config is invalid: Bad value")
  })
})

describe("formatServerError", () => {
  test("formats config invalid errors", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        message: "Missing host",
      },
    } satisfies ConfigInvalidError

    const result = formatServerError(error)

    expect(result).toBe("Config file at config is invalid: Missing host")
  })

  test("returns error messages", () => {
    expect(formatServerError(new Error("Request failed with status 503"))).toBe("Request failed with status 503")
  })

  test("returns provided string errors", () => {
    expect(formatServerError("Failed to connect to server")).toBe("Failed to connect to server")
  })

  test("uses unknown fallback", () => {
    expect(formatServerError(0)).toBe("Unknown error")
  })

  test("falls back for unknown error objects and names", () => {
    expect(formatServerError({ name: "ServerTimeoutError", data: { seconds: 30 } })).toBe("Unknown error")
  })

  test("formats provider model errors using provider/model", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "openai",
        modelID: "gpt-4.1",
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error)).toBe(
      ["Model not found: openai/gpt-4.1", "Check your config (opencode.json) provider/model names"].join("\n"),
    )
  })

  test("formats provider model suggestions", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "x",
        modelID: "y",
        suggestions: ["x/y2", "x/y3"],
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error)).toBe(
      ["Model not found: x/y", "Did you mean: x/y2, x/y3", "Check your config (opencode.json) provider/model names"].join(
        "\n",
      ),
    )
  })

  test("unwraps SDK-wrapped errors from cause.body", () => {
    const body = {
      name: "ConfigInvalidError",
      data: {
        message: "Missing host",
      },
    } satisfies ConfigInvalidError

    const wrapped = new Error("ConfigInvalidError", { cause: { body, status: 400 } })

    expect(formatServerError(wrapped)).toBe("Config file at config is invalid: Missing host")
  })
})

describe("isSessionNotFoundError", () => {
  test("matches an SDK-wrapped error for the requested session", () => {
    const body = {
      _tag: "SessionNotFoundError",
      sessionID: "ses_missing",
      message: "Session not found",
    } satisfies SessionNotFoundError

    expect(isSessionNotFoundError(new Error(body.message, { cause: { body, status: 404 } }), body.sessionID)).toBe(true)
  })

  test("rejects errors for other sessions and other 404 responses", () => {
    const body = {
      _tag: "SessionNotFoundError",
      sessionID: "ses_parent",
      message: "Session not found",
    } satisfies SessionNotFoundError

    expect(isSessionNotFoundError(new Error(body.message, { cause: { body, status: 404 } }), "ses_tab")).toBe(false)
    expect(
      isSessionNotFoundError(
        new Error("Provider not found", {
          cause: { body: { _tag: "ProviderNotFoundError", providerID: "missing" }, status: 404 },
        }),
        "ses_tab",
      ),
    ).toBe(false)
  })
})
