import { describe, expect, test } from "bun:test"
import { idFor } from "@/design/registry"

describe("prototype identity", () => {
  test("the same directory in the same session keeps one id, so one open tab keeps working", () => {
    expect(idFor("ses_1", "/w/.redcode/designs/hero")).toBe(idFor("ses_1", "/w/.redcode/designs/hero"))
  })

  test("a different session or a different directory is a different prototype", () => {
    expect(idFor("ses_1", "/w/a")).not.toBe(idFor("ses_2", "/w/a"))
    expect(idFor("ses_1", "/w/a")).not.toBe(idFor("ses_1", "/w/b"))
  })

  test("the id is safe to put in a URL", () => {
    const id = idFor("ses_1", "/w/.redcode/designs/hero world")
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(id)).toBe(id)
  })
})
