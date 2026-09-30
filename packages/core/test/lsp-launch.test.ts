import { describe, expect, test } from "bun:test"
import { LSPLaunch } from "../src/lsp/launch"

describe("LSPLaunch.rejectedNodeOption", () => {
  test("reads the flag from Node's invalid-argument exit", () => {
    expect(LSPLaunch.rejectedNodeOption(9, "node: --experimental-foo is not allowed in NODE_OPTIONS\n")).toBe(
      "--experimental-foo",
    )
  })

  test("accepts a full runtime path and Windows line endings", () => {
    expect(
      LSPLaunch.rejectedNodeOption(
        9,
        "warning: something\r\nC:\\node\\node.exe: --inspect-publish-uid is not allowed in NODE_OPTIONS\r\n",
      ),
    ).toBe("--inspect-publish-uid")
  })

  test("ignores other exit codes", () => {
    expect(LSPLaunch.rejectedNodeOption(1, "node: --foo is not allowed in NODE_OPTIONS")).toBeUndefined()
    expect(LSPLaunch.rejectedNodeOption(null, "node: --foo is not allowed in NODE_OPTIONS")).toBeUndefined()
  })

  test("ignores prose that only mentions NODE_OPTIONS", () => {
    expect(LSPLaunch.rejectedNodeOption(9, "NODE_OPTIONS is not allowed here")).toBeUndefined()
    expect(LSPLaunch.rejectedNodeOption(9, "node: bad option is not allowed in NODE_OPTIONS")).toBeUndefined()
    expect(LSPLaunch.rejectedNodeOption(9, undefined)).toBeUndefined()
  })
})

describe("LSPLaunch.withoutNodeOption", () => {
  test("strips the rejected flag with or without an inline value", () => {
    expect(LSPLaunch.withoutNodeOption("--max-old-space-size=4096 --foo --bar=1", "--foo")).toBe(
      "--max-old-space-size=4096 --bar=1",
    )
    expect(LSPLaunch.withoutNodeOption("--foo=1 --max-old-space-size=4096", "--foo")).toBe("--max-old-space-size=4096")
  })

  test("keeps quoted values intact", () => {
    expect(LSPLaunch.withoutNodeOption('--require "/a path/x.js" --foo', "--foo")).toBe('--require "/a path/x.js"')
  })

  test("returns an empty value when nothing remains", () => {
    expect(LSPLaunch.withoutNodeOption("--foo", "--foo")).toBe("")
    expect(LSPLaunch.withoutNodeOption(undefined, "--foo")).toBe("")
  })
})
