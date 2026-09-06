import { describe, expect, test } from "bun:test"
import path from "path"
import { ProjectDir } from "../src/project-dir"

describe("the project's own directory", () => {
  test("is .red/code, with the older names still read and never preferred", () => {
    expect(ProjectDir.DIR).toBe(path.join(".red", "code"))
    expect(ProjectDir.LEGACY_DIRS).toEqual([".opencode", ".redcode"])
    // Lowest precedence first, so a walk applied front to back ends on the current name.
    expect(ProjectDir.DIRS).toEqual([".opencode", ".redcode", path.join(".red", "code")])
    expect(ProjectDir.DIRS_PREFERRED_FIRST[0]).toBe(ProjectDir.DIR)
  })

  test("is recognised by its last segments, not by a name that merely looks like one", () => {
    expect(ProjectDir.isProjectDir("/w/project/.red/code")).toBe(true)
    expect(ProjectDir.isProjectDir("/w/project/.redcode")).toBe(true)
    expect(ProjectDir.isProjectDir("/w/project/.opencode")).toBe(true)
    expect(ProjectDir.isProjectDir("C:\\w\\project\\.red\\code")).toBe(true)
    // A directory called `code` is not one, and neither is one that only ends in `.red`.
    expect(ProjectDir.isProjectDir("/w/project/code")).toBe(false)
    expect(ProjectDir.isProjectDir("/w/project/.red")).toBe(false)
    expect(ProjectDir.isProjectDir("/w/code/.redcodex")).toBe(false)
    expect(ProjectDir.isProjectDir("/w/.red/code/themes")).toBe(false)
    expect(ProjectDir.isProjectDir("")).toBe(false)
  })

  test("offers the current name first, so a reader takes what is there and a writer takes ours", () => {
    expect(ProjectDir.candidates("/w", "plans", "a.md")).toEqual([
      path.join("/w", ".red", "code", "plans", "a.md"),
      path.join("/w", ".redcode", "plans", "a.md"),
      path.join("/w", ".opencode", "plans", "a.md"),
    ])
    expect(ProjectDir.candidates("/w")[0]).toBe(path.join("/w", ".red", "code"))
  })
})
