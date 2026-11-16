import { describe, expect, test } from "bun:test"
import { VcsPatch } from "../src/vcs/patch"

describe("VcsPatch", () => {
  test("counts changes without treating file headers as edits", () => {
    expect(
      VcsPatch.countPatch(
        [
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,3 +1,4 @@",
          " context",
          "-removed",
          "+added",
          "+another",
          "",
        ].join("\n"),
      ),
    ).toEqual({ additions: 2, deletions: 1 })
  })

  test("counts a final line without a newline and ignores empty input", () => {
    expect(VcsPatch.countPatch("+added\n-removed")).toEqual({ additions: 1, deletions: 1 })
    expect(VcsPatch.countPatch("")).toEqual({ additions: 0, deletions: 0 })
  })
})
