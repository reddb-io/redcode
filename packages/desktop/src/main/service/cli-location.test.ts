import { describe, expect, test } from "bun:test"
import { locateCli } from "./cli-location"

const POINTER = "/home/me/.red/code/state/desktop.json"
const NPM_CLI = "/home/me/app/node_modules/@reddb-io/redcode-linux-x64/bin/redcode"
const NPM_APP = "/home/me/.cache/redcode/desktop/1.2.3/redcode-desktop"

describe("locateCli", () => {
  test.each([
    {
      name: "the environment, over an archive sibling",
      platform: "linux",
      env: { REDCODE_DESKTOP_CLI: "/usr/local/bin/redcode" },
      resourcesPath: "/opt/redcode/desktop/resources",
      files: { "/opt/redcode/redcode": "" },
      expected: { source: "environment", binary: "/usr/local/bin/redcode", version: "1.2.3" },
    },
    {
      name: "a Linux archive sibling",
      platform: "linux",
      resourcesPath: "/opt/redcode/desktop/resources",
      files: { "/opt/redcode/redcode": "" },
      expected: { source: "archive", binary: "/opt/redcode/redcode", version: "1.2.3" },
    },
    {
      name: "a Windows archive sibling",
      platform: "win32",
      resourcesPath: "C:\\Tools\\redcode\\desktop\\resources",
      execPath: "C:\\Tools\\redcode\\desktop\\Redcode.exe",
      files: { "C:\\Tools\\redcode\\redcode.exe": "" },
      expected: { source: "archive", binary: "C:\\Tools\\redcode\\redcode.exe", version: "1.2.3" },
    },
    {
      name: "a macOS archive sibling",
      platform: "darwin",
      resourcesPath: "/Users/me/redcode/desktop/Redcode.app/Contents/Resources",
      files: { "/Users/me/redcode/redcode": "" },
      expected: { source: "archive", binary: "/Users/me/redcode/redcode", version: "1.2.3" },
    },
    {
      name: "PATH, when the app folder is not named desktop",
      platform: "linux",
      resourcesPath: "/opt/redcode/app/resources",
      files: { "/opt/redcode/redcode": "" },
      expected: { source: "development", binary: "redcode" },
    },
    {
      name: "a pointer naming this app",
      platform: "linux",
      resourcesPath: "/home/me/.cache/redcode/desktop/1.2.3/resources",
      execPath: NPM_APP,
      files: { [POINTER]: JSON.stringify({ version: "1.2.4", cli: NPM_CLI, app: NPM_APP }), [NPM_CLI]: "" },
      expected: { source: "pointer", binary: NPM_CLI, version: "1.2.4" },
    },
    {
      name: "a pointer naming this macOS app bundle",
      platform: "darwin",
      resourcesPath: "/Users/me/Library/Caches/redcode/desktop/1.2.3/Redcode.app/Contents/Resources",
      execPath: "/Users/me/Library/Caches/redcode/desktop/1.2.3/Redcode.app/Contents/MacOS/Redcode",
      files: {
        [POINTER]: JSON.stringify({
          version: "1.2.3",
          cli: NPM_CLI,
          app: "/Users/me/Library/Caches/redcode/desktop/1.2.3/Redcode.app",
        }),
        [NPM_CLI]: "",
      },
      expected: { source: "pointer", binary: NPM_CLI, version: "1.2.3" },
    },
    {
      name: "a pointer naming this Windows app in another case",
      platform: "win32",
      resourcesPath: "C:\\Users\\me\\AppData\\Local\\redcode\\desktop\\1.2.3\\resources",
      execPath: "C:\\Users\\me\\AppData\\Local\\redcode\\desktop\\1.2.3\\Redcode.exe",
      files: {
        [POINTER]: JSON.stringify({
          version: "1.2.3",
          cli: "C:\\npm\\redcode.exe",
          app: "c:\\users\\me\\appdata\\local\\redcode\\desktop\\1.2.3\\Redcode.exe",
        }),
        "C:\\npm\\redcode.exe": "",
      },
      expected: { source: "pointer", binary: "C:\\npm\\redcode.exe", version: "1.2.3" },
    },
    {
      name: "PATH, when the pointer names another app",
      platform: "linux",
      resourcesPath: "/home/me/.cache/redcode/desktop/1.2.3/resources",
      execPath: NPM_APP,
      files: {
        [POINTER]: JSON.stringify({
          version: "1.2.2",
          cli: NPM_CLI,
          app: "/home/me/.cache/redcode/desktop/1.2.2/redcode-desktop",
        }),
        [NPM_CLI]: "",
      },
      expected: { source: "development", binary: "redcode" },
    },
    {
      name: "PATH, when the pointer names a removed CLI",
      platform: "linux",
      resourcesPath: "/home/me/.cache/redcode/desktop/1.2.3/resources",
      execPath: NPM_APP,
      files: { [POINTER]: JSON.stringify({ version: "1.2.3", cli: NPM_CLI, app: NPM_APP }) },
      expected: { source: "development", binary: "redcode" },
    },
    {
      name: "PATH, when the pointer is malformed",
      platform: "linux",
      resourcesPath: "/home/me/.cache/redcode/desktop/1.2.3/resources",
      execPath: NPM_APP,
      files: { [POINTER]: JSON.stringify({ cli: NPM_CLI, app: NPM_APP }), [NPM_CLI]: "" },
      expected: { source: "development", binary: "redcode" },
    },
    {
      name: "REDCODE_BIN",
      platform: "linux",
      env: { REDCODE_BIN: "/src/redcode/dist/redcode" },
      resourcesPath: "/opt/Redcode/resources",
      files: {},
      expected: { source: "development", binary: "/src/redcode/dist/redcode" },
    },
    {
      name: "PATH on Windows",
      platform: "win32",
      resourcesPath: "C:\\src\\node_modules\\electron\\dist\\resources",
      execPath: "C:\\src\\node_modules\\electron\\dist\\electron.exe",
      files: {},
      expected: { source: "development", binary: "redcode.exe" },
    },
  ] satisfies {
    name: string
    platform: NodeJS.Platform
    env?: Record<string, string>
    resourcesPath: string
    execPath?: string
    files: Record<string, string>
    expected: ReturnType<typeof locateCli>
  }[])("uses $name", (input) => {
    const files = new Map(Object.entries(input.files))

    expect(
      locateCli({
        env: input.env ?? {},
        platform: input.platform,
        resourcesPath: input.resourcesPath,
        execPath: input.execPath ?? "/opt/redcode/desktop/redcode-desktop",
        version: "1.2.3",
        pointer: POINTER,
        exists: (file) => files.has(file),
        read: (file) => files.get(file),
      }),
    ).toEqual(input.expected)
  })
})
