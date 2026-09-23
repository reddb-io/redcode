---
"@reddb-io/redcode": patch
---

Design's session side is now one typed HTTP contract, `design.host` under `/api/design`: the conversation list, review launches, the feed, feedback, approval and permission requests. The TUI's Design picker and review command and `redcode design --open` use it instead of the untyped `/design/list` and `/design/session/:id/{open,launch}` routes, which are removed. Unused vendored export code leaves the package.
