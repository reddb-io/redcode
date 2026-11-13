import { describe, expect, test } from "bun:test"
import { taskTree } from "../src/task-tree.js"

describe("taskTree", () => {
  test("keeps input order while nesting descendants", () => {
    const tasks = [
      { id: "root" },
      { id: "sibling" },
      { id: "child", parentID: "root" },
      { id: "grandchild", parentID: "child" },
    ]
    expect(taskTree(tasks).map(({ task, depth }) => [task.id, depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
      ["sibling", 0],
    ])
  })

  test("keeps an orphan visible and bounds malformed cycles", () => {
    const orphan = { id: "orphan", parentID: "missing" }
    const one = { id: "one", parentID: "two" }
    const two = { id: "two", parentID: "one" }
    expect(taskTree([orphan, one, two]).map(({ task, depth }) => [task.id, depth])).toEqual([
      ["orphan", 0],
      ["one", 0],
      ["two", 1],
    ])
  })
})
