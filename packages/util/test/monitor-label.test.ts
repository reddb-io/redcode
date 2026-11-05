import { expect, test } from "bun:test"
import { monitorLabel } from "../src/monitor-label.js"

test("shows the monitored operation without URL credentials, query strings or terminal controls", () => {
  expect(
    monitorLabel({ id: "mon_build", command: "\x1b[31mGET https://user:pass@example.com/health?token=secret" }),
  ).toBe("GET https://example.com/health (mon_build)")
  expect(monitorLabel({ id: "mon_empty", command: "\n" })).toBe("mon_empty")
})
