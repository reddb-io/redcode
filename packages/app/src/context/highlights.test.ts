import { expect, test } from "bun:test"
import { loadReleaseHighlights } from "./highlights"

test("loads structured desktop highlights", () => {
  expect(
    loadReleaseHighlights(
      {
        releases: [
          {
            tag: "v1.2.0",
            highlights: [
              {
                source: "desktop",
                items: [{ title: "Faster search", description: "Search large repositories with less delay." }],
              },
              {
                source: "cli",
                items: [{ title: "Ignored", description: "Not a desktop highlight." }],
              },
            ],
          },
        ],
      },
      "1.2.0",
      "1.1.0",
    ),
  ).toEqual([{ title: "Faster search", description: "Search large repositories with less delay." }])
})

test("loads Redcode GitHub release notes", () => {
  expect(
    loadReleaseHighlights(
      [
        {
          tag_name: "v0.13.0",
          name: "Redcode v0.13.0",
          body: [
            "## What's Changed",
            "* feat(core): add location-scoped hooks by @author in https://github.com/reddb-io/redcode/pull/1",
            "* chore(release): version packages by @author in https://github.com/reddb-io/redcode/pull/2",
          ].join("\n"),
        },
      ],
      "0.13.0",
      "0.12.0",
    ),
  ).toEqual([{ title: "Add location-scoped hooks", description: "Redcode v0.13.0" }])
})
