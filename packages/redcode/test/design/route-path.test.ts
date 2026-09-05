import { describe, expect, test } from "bun:test"
import { parse } from "@/design/route-path"

describe("the shape of the design surface", () => {
  test("tells the shell apart from the bytes it frames", () => {
    expect(parse("/design/abc")).toEqual({ kind: "shell", id: "abc" })
    expect(parse("/design/abc/")).toEqual({ kind: "shell", id: "abc" })
    expect(parse("/design/abc/files/index.html")).toEqual({ kind: "file", id: "abc", path: "/index.html" })
    expect(parse("/design/abc/files/assets/app.css")).toEqual({ kind: "file", id: "abc", path: "/assets/app.css" })
    expect(parse("/design/abc/revision")).toEqual({ kind: "revision", id: "abc" })
    expect(parse("/design/abc/feedback")).toEqual({ kind: "feedback", id: "abc" })
  })

  test("claims nothing outside its own prefix", () => {
    // The UI catch-all serves everything else, so anything not clearly ours must fall through.
    expect(parse("/")).toBeUndefined()
    expect(parse("/api/session/x/prompt")).toBeUndefined()
    expect(parse("/designs/abc")).toBeUndefined()
    expect(parse("/design/abc/unknown")).toBeUndefined()
  })

  test("refuses an id that could smuggle a path", () => {
    expect(parse("/design/../../etc/files/passwd")).toBeUndefined()
    expect(parse("/design/a%2Fb/files/x.html")).toBeUndefined()
    expect(parse("/design//files/x.html")).toBeUndefined()
  })
})
