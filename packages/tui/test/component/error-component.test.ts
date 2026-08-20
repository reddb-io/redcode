import { expect, test } from "bun:test"
import { buildIssueURL } from "../../src/component/error-component"

test("crash reports target Redcode", () => {
  const url = buildIssueURL("render failed", "stack trace")

  expect(url.origin + url.pathname).toBe("https://github.com/reddb-io/redcode/issues/new")
  expect(url.searchParams.get("template")).toBe("bug-report.yml")
  expect(url.searchParams.get("description")).toContain("Redcode TUI crashed")
  expect(url.searchParams.get("reproduce")).toContain("Redcode crash screen")
})
