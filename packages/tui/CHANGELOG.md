# @reddb-io/redcode-tui

## 1.21.1

### Patch Changes

- Updated dependencies [fce66aa]
- Updated dependencies [8993328]
- Updated dependencies [6e2e844]
  - @reddb-io/redcode-core@1.22.0

## 1.21.0

### Minor Changes

- d9dcc88: Latency and output speed on the panel

  Every assistant message now records when its first streamed chunk arrived (`time.first`). The TUI footer shows the last reply's latency and its output rate next to context and cost — `1.2s · 84 tk/s` — and the app shows both in the context tooltip and the context tab. Speed counts output plus reasoning tokens from the first chunk to completion; latency is the wait from the request to that first chunk. Messages from before this release show neither rather than a guess.

### Patch Changes

- Updated dependencies [d9dcc88]
  - @reddb-io/redcode-sdk@1.19.1
  - @reddb-io/redcode-core@1.21.1
  - @reddb-io/redcode-plugin@1.18.20

## 1.20.0

### Minor Changes

- e2002a5: `/goal` in the TUI and the app

  `/goal` opens a prompt for the definition of done; `/goal-pause`, `/goal-resume`, `/goal-drop` do what they say. The TUI footer shows `goal · turn 3/20`, or the reason it is paused or blocked; the app shows the same line above the composer, with the objective.

### Patch Changes

- Updated dependencies [a4e53f8]
- Updated dependencies [f53faea]
  - @reddb-io/redcode-core@1.21.0
  - @reddb-io/redcode-sdk@1.19.0
  - @reddb-io/redcode-plugin@1.18.19

## 1.19.1

### Patch Changes

- be2fcd5: Build is red, plan is gold, design is cyan — everywhere, including the loading bar

  The brand theme had set primary, secondary and accent all to RedDB reds, and agents took their colour from that palette by position, so every mode looked the same. Each built-in agent now names its colour: build red, plan gold, design a cyan a shade under bright. The TUI's loading scanner takes its head from the agent's own colour instead of the theme accent, so it changes with the mode again. The app gets a design token to match.

- 2e219a9: Ported from upstream: five TUI fixes

  Encrypted reasoning shows as a thought with its duration instead of nothing; home shortcuts stay right-aligned; the diff highlight query is pinned; interface text uses a real ellipsis.

- Updated dependencies [be2fcd5]
- Updated dependencies [b331e2e]
- Updated dependencies [2b6e24e]
- Updated dependencies [4ad8dc9]
- Updated dependencies [f9100dc]
- Updated dependencies [150c010]
- Updated dependencies [9c22b55]
  - @reddb-io/redcode-core@1.20.1
  - @reddb-io/redcode-ui@1.18.19

## 1.19.0

### Minor Changes

- c5cf65a: Design mode: work out what something should be by building it, then turn that into a plan

  A third mode beside build and plan. The `design` agent writes a prototype into `.redcode/designs/`, opens it with `design_preview`, and the user talks back from either side: alt-click an element in the browser (or the app's new Design tab) and say what should change, or just say it in the chat. Each preview carries craft notes when the prototype reaches for the patterns reviewers recognise as generated. `design.json` beside the prototype keeps the decisions settled and the questions open, and `design_exit` writes the plan from it. Behind `REDCODE_EXPERIMENTAL_DESIGN_MODE`.

### Patch Changes

- Updated dependencies [c5cf65a]
  - @reddb-io/redcode-core@1.20.0

## 1.18.20

### Patch Changes

- Updated dependencies [68c96b4]
- Updated dependencies [7246ae1]
  - @reddb-io/redcode-core@1.19.0

## 1.18.19

### Patch Changes

- Updated dependencies [78d1b03]
- Updated dependencies [8c43207]
- Updated dependencies [603d8c7]
- Updated dependencies [86b2250]
  - @reddb-io/redcode-core@1.18.19
