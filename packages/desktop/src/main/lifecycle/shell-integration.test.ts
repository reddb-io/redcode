import { describe, expect, test } from "bun:test"
import { desktopEntry, stale } from "./shell-integration"

const current = { app: "/opt/redcode/desktop/io.reddb.redcode", version: "1.2.3" }

describe("shell integration", () => {
  test.each([
    { name: "a first launch", stored: undefined, expected: true },
    { name: "a malformed record", stored: { app: current.app }, expected: true },
    { name: "another installation", stored: { ...current, app: "/home/me/.cache/desktop/1.2.3/io.reddb.redcode" }, expected: true },
    { name: "an upgrade in place", stored: { ...current, version: "1.2.2" }, expected: true },
    { name: "the registered app", stored: current, expected: false },
  ])("registers again after $name: $expected", (input) => {
    expect(stale(input.stored, current)).toBe(input.expected)
  })

  test.each([
    { name: "a plain path", executable: "/opt/redcode/desktop/io.reddb.redcode", exec: '"/opt/redcode/desktop/io.reddb.redcode"' },
    { name: "spaces", executable: "/home/me/My Apps/io.reddb.redcode", exec: '"/home/me/My Apps/io.reddb.redcode"' },
    // The quoting rule escapes ", `, $ and \; the string rule then doubles every backslash, and % is %%.
    { name: "reserved characters", executable: '/a"b`c$d\\e%f/x', exec: '"/a\\\\"b\\\\`c\\\\$d\\\\\\\\e%%f/x"' },
  ])("launches the app at a path with $name and opens redcode:// links", (input) => {
    expect(
      desktopEntry({ appId: "io.reddb.redcode", name: "Redcode", scheme: "redcode", executable: input.executable }),
    ).toBe(
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Redcode",
        `Exec=${input.exec} %U`,
        "Icon=io.reddb.redcode",
        "Terminal=false",
        "Categories=Development;",
        "MimeType=x-scheme-handler/redcode;",
        "StartupWMClass=io.reddb.redcode",
        "",
      ].join("\n"),
    )
  })
})
