import { expect, test } from "bun:test"
import { Schema } from "effect"
import { TuiEvent } from "@reddb-io/redcode-schema/tui-event"
import { DesignAppClient } from "../../src/design/app"

test("a first-use download of the design app is a TUI status with its progress", () => {
  const shown = DesignAppClient.status({ phase: "download", version: "0.1.0", received: 45, total: 100, started: 0 })
  expect(shown).toEqual({ message: "Downloading redcode-design 0.1.0… 45%", variant: "info", duration: 8_000 })
  // It is a toast the TUI accepts as it is.
  expect(Schema.decodeUnknownSync(TuiEvent.ToastShow.data)(shown)).toMatchObject({
    message: "Downloading redcode-design 0.1.0… 45%",
  })
  expect(
    DesignAppClient.status({ phase: "download", version: "0.1.0", received: 2_000_000, started: 0 })?.message,
  ).toBe("Downloading redcode-design 0.1.0… 2.0 MB")
})

test("starting an installed app, or nothing in progress, shows no download status", () => {
  expect(DesignAppClient.status({ phase: "start", version: "0.1.0", received: 0, started: 0 })).toBeUndefined()
  expect(DesignAppClient.status(undefined)).toBeUndefined()
})
