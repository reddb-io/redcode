import { expect, test } from "bun:test"
import { getCachedMarkdown, touchCachedMarkdown } from "./markdown-cache"

test("bounds Markdown cache by size and retains recently used entries", () => {
  const block = "x".repeat(6 * 1024 * 1024)
  const entry = { raw: block, html: "", hash: "hash" }
  touchCachedMarkdown("budget-a", entry)
  touchCachedMarkdown("budget-b", entry)
  touchCachedMarkdown("budget-a", entry)
  touchCachedMarkdown("budget-c", entry)
  expect(getCachedMarkdown("budget-b")).toBeUndefined()
  expect(getCachedMarkdown("budget-a")).toBe(entry)
  expect(getCachedMarkdown("budget-c")).toBe(entry)
})

test("replacing a key updates its size and an oversized newest entry remains readable", () => {
  const small = { raw: "small", html: "", hash: "hash" }
  const oversized = { raw: "x".repeat(17 * 1024 * 1024), html: "", hash: "hash" }
  touchCachedMarkdown("budget-replace", small)
  touchCachedMarkdown("budget-replace", oversized)
  expect(getCachedMarkdown("budget-replace")).toBe(oversized)
  touchCachedMarkdown("budget-next", small)
  expect(getCachedMarkdown("budget-replace")).toBeUndefined()
  expect(getCachedMarkdown("budget-next")).toBe(small)
})

test("evicts the oldest entry when the entry count exceeds 200", () => {
  const small = { raw: "x", html: "y", hash: "z" }
  for (let index = 0; index < 201; index++) touchCachedMarkdown(`count-${index}`, small)
  expect(getCachedMarkdown("count-0")).toBeUndefined()
  expect(getCachedMarkdown("count-200")).toBe(small)
})
