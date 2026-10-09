import { expect, test } from "bun:test"
import { newerRelease } from "./release"

const release = (tag_name: string, prerelease = false) => ({ tag_name, prerelease, name: tag_name, assets: [] })

// The GitHub release list mixes CLI releases with the retired desktop and design ones, newest first by date.
test.each([
  {
    name: "a newer stable release",
    releases: [release("desktop-v9.0.0"), release("design-v8.0.0"), release("v1.3.0"), release("v1.2.0")],
    current: "1.2.0",
    expected: { status: "newer", version: "1.3.0" },
  },
  {
    name: "the current version is the newest",
    releases: [release("desktop-v9.0.0"), release("v1.2.0")],
    current: "1.2.0",
    expected: { status: "current" },
  },
  {
    name: "a prerelease never counts as newer",
    releases: [release("v1.3.0-beta.1", true), release("v1.4.0", true), release("v1.2.0")],
    current: "1.2.0",
    expected: { status: "current" },
  },
  {
    name: "the newest version wins over list order",
    releases: [release("v1.2.9"), release("v1.10.0"), release("v1.9.0")],
    current: "1.2.0",
    expected: { status: "newer", version: "1.10.0" },
  },
  {
    name: "a prerelease of the newest version is older than it",
    releases: [release("v1.3.0")],
    current: "1.3.0-beta.2",
    expected: { status: "newer", version: "1.3.0" },
  },
  {
    name: "a build newer than every release is current",
    releases: [release("v1.3.0")],
    current: "1.4.0-dev",
    expected: { status: "current" },
  },
  { name: "no CLI release", releases: [release("desktop-v9.0.0")], current: "1.2.0", expected: { status: "unknown" } },
  {
    name: "an unreadable list",
    releases: { message: "rate limited" },
    current: "1.2.0",
    expected: { status: "unknown" },
  },
  { name: "no current version", releases: [release("v1.3.0")], current: undefined, expected: { status: "unknown" } },
])("$name", (row) => {
  expect(newerRelease(row.releases, row.current)).toEqual(row.expected)
})
