# @reddb-io/redcode-app

## 1.20.0

### Minor Changes

- e2002a5: `/goal` in the TUI and the app

  `/goal` opens a prompt for the definition of done; `/goal-pause`, `/goal-resume`, `/goal-drop` do what they say. The TUI footer shows `goal · turn 3/20`, or the reason it is paused or blocked; the app shows the same line above the composer, with the objective.

### Patch Changes

- Updated dependencies [a4e53f8]
- Updated dependencies [f53faea]
  - @reddb-io/redcode-core@1.21.0
  - @reddb-io/redcode-sdk@1.19.0
  - @reddb-io/redcode-session-ui@1.18.23

## 1.19.2

### Patch Changes

- be2fcd5: Build is red, plan is gold, design is cyan — everywhere, including the loading bar

  The brand theme had set primary, secondary and accent all to RedDB reds, and agents took their colour from that palette by position, so every mode looked the same. Each built-in agent now names its colour: build red, plan gold, design a cyan a shade under bright. The TUI's loading scanner takes its head from the agent's own colour instead of the theme accent, so it changes with the mode again. The app gets a design token to match.

- 2b6e24e: Ported from upstream: ten app and ui fixes

  Server details stay editable; file search results are preserved while loading; the archive-session command is registered in both layouts and archived sessions leave the home list at once; model provider headers stay visible; focus is restored in stacked dialogs; session rename and tab menu fixes; the open-in icon is larger; desktop identifies itself in device auth; and happy-dom is bumped to the version that fixes the GC-dependent MutationObserver flake.

- Updated dependencies [be2fcd5]
- Updated dependencies [b331e2e]
- Updated dependencies [2b6e24e]
- Updated dependencies [4ad8dc9]
- Updated dependencies [f9100dc]
- Updated dependencies [150c010]
- Updated dependencies [9c22b55]
  - @reddb-io/redcode-core@1.20.1
  - @reddb-io/redcode-ui@1.18.19
  - @reddb-io/redcode-session-ui@1.18.22

## 1.19.1

### Patch Changes

- 7bc774e: Design mode: a note can carry an image, and notes can be held

  In the review window, paste or drop a screenshot or sketch beside what you type; it reaches the agent as a reference for that note, downscaled in the browser and checked by its bytes on the server. A Hold button keeps notes on the page until you press Send, so one message can carry a whole review — nothing accumulates on the server and nothing wakes the agent but Send. The app's Design tab no longer remounts the review surface on every revision, which was throwing held notes away.

## 1.19.0

### Minor Changes

- c5cf65a: Design mode: work out what something should be by building it, then turn that into a plan

  A third mode beside build and plan. The `design` agent writes a prototype into `.redcode/designs/`, opens it with `design_preview`, and the user talks back from either side: alt-click an element in the browser (or the app's new Design tab) and say what should change, or just say it in the chat. Each preview carries craft notes when the prototype reaches for the patterns reviewers recognise as generated. `design.json` beside the prototype keeps the decisions settled and the questions open, and `design_exit` writes the plan from it. Behind `REDCODE_EXPERIMENTAL_DESIGN_MODE`.

### Patch Changes

- Updated dependencies [c5cf65a]
  - @reddb-io/redcode-core@1.20.0
  - @reddb-io/redcode-session-ui@1.18.21

## 1.18.20

### Patch Changes

- f94e2cb: Close turns left open by a process that died, and stop calling them a queue

  `time.completed` on an assistant message is written by the process running the turn. Killed mid-turn — an OOM, a machine going to sleep — nobody writes it, and the message stays open for the rest of the session's life. The TUI reads an open assistant message as a turn in progress and stamps QUEUED on everything typed after it, across restarts, with nothing running: a session that survived one crash looks jammed forever. A fresh run now closes anything left behind by a run that is gone, records it, and the QUEUED badge requires the session to actually be busy.

- Updated dependencies [68c96b4]
- Updated dependencies [7246ae1]
  - @reddb-io/redcode-core@1.19.0
  - @reddb-io/redcode-schema@1.20.0
  - @reddb-io/redcode-session-ui@1.18.20

## 1.18.19

### Patch Changes

- 872f6da: Re-arm the timeline offset watch however the mutation batch is ordered

  A batch that carries both the removal and the re-insertion of the scroll element can present them in either order, and the reconnect was decided record by record: with the addition first, it was judged before the removal had been seen, so the element returned to the page with nothing watching its offset. The batch is now judged as a whole.

- Updated dependencies [78d1b03]
- Updated dependencies [82bb18a]
- Updated dependencies [8c43207]
- Updated dependencies [603d8c7]
- Updated dependencies [86b2250]
  - @reddb-io/redcode-core@1.18.19
  - @reddb-io/redcode-schema@1.19.0
  - @reddb-io/redcode-session-ui@1.18.19
