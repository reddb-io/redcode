---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
"@reddb-io/redcode-tui": minor
"@reddb-io/redcode-app": minor
---

Design mode: work out what something should be by building it, then turn that into a plan

A third mode beside build and plan. The `design` agent writes a prototype into `.redcode/designs/`, opens it with `design_preview`, and the user talks back from either side: alt-click an element in the browser (or the app's new Design tab) and say what should change, or just say it in the chat. Each preview carries craft notes when the prototype reaches for the patterns reviewers recognise as generated. `design.json` beside the prototype keeps the decisions settled and the questions open, and `design_exit` writes the plan from it. Behind `REDCODE_EXPERIMENTAL_DESIGN_MODE`.
