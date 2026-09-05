# @reddb-io/redcode-core

## 1.20.0

### Minor Changes

- c5cf65a: Design mode: work out what something should be by building it, then turn that into a plan

  A third mode beside build and plan. The `design` agent writes a prototype into `.redcode/designs/`, opens it with `design_preview`, and the user talks back from either side: alt-click an element in the browser (or the app's new Design tab) and say what should change, or just say it in the chat. Each preview carries craft notes when the prototype reaches for the patterns reviewers recognise as generated. `design.json` beside the prototype keeps the decisions settled and the questions open, and `design_exit` writes the plan from it. Behind `REDCODE_EXPERIMENTAL_DESIGN_MODE`.

## 1.19.0

### Minor Changes

- 68c96b4: Write down every time a guard intervenes, so the thresholds can be argued from evidence

  Five guards ship in 0.14.0 — the inactivity watchdog, tool deadlines, the loop guard, the step budget, the bounds on naming and compacting — and every threshold in them was chosen by argument, because there was nothing to measure. Each intervention is now recorded with which guard fired, what it acted on, and what it did, and published as a live `session.next.guard.tripped` event. `redcode debug guards` reads it back: counts per guard and action over the last week, loudest first, plus the most recent trips. An empty report says so in words, because "nothing fired" and "nothing was collected" are different answers.

- 7246ae1: Notice a call that never stops being made, even when the answer keeps changing

  Comparing results is what keeps the loop guard off polling's back, and it was also the way through it: an answer carrying a timestamp, a pid or a temporary path never repeats byte for byte, so the same call could run all turn without ever counting as repetition. At twelve identical calls in a row the repetition is mentioned once — the call still runs, because polling looks exactly like this and is sometimes right. Configurable as `experimental.loop_guard.nudge_at`.

### Patch Changes

- Updated dependencies [68c96b4]
  - @reddb-io/redcode-schema@1.20.0
  - @reddb-io/redcode-llm@1.18.20

## 1.18.19

### Patch Changes

- 78d1b03: Bound the model calls a turn makes that are not the turn itself

  Naming a session and compacting the conversation both call a provider outside the step loop, where the turn's inactivity watchdog cannot see them: one runs before any step handle exists, the other creates a processor of its own. A provider that stopped answering during either held the turn open with nothing on screen and no error. Both now give up — naming after two minutes, compacting after ten — and say so. A session keeping its default name is a far smaller loss than a turn that never starts. Configurable via `experimental.aux_timeout`.

- 8c43207: Notice when the model is repeating itself, and say so instead of asking the user

  The old detector compared the last three parts of a single assistant message and required byte-identical serialized input, so one interleaved reasoning part — which reasoning models emit constantly — reset it permanently, a loop spanning steps was invisible, and when it did fire it asked a question whose wait had no bound: the only defence against a loop was itself a way to hang. It now looks across the whole turn, counts only calls that returned the same result (identical calls with different results are polling, and are left alone), and answers the repeated call itself with a correction quoting the model's own arguments and the answer it keeps ignoring. If the correction changes nothing, the turn ends. Nobody is asked anything. Configurable via `experimental.loop_guard`; a `doom_loop: "allow"` permission rule still turns it off.

- 603d8c7: Ask for a report before the step ceiling instead of cutting the turn off at it

  The turn ceiling was a cliff: at step 200 the turn stopped and everything the model had worked out but not yet written down went with it, leaving the user told to "send another message to continue" with nothing to base it on. The last steps before the wall are now spent the way `agent.steps` already spends its own: tools off, a summary of what was done, what is left, and what to do next. The wall itself is unchanged, for a model that will not yield. Configurable via `experimental.turn_steps`.

- 86b2250: Stop a tool that never returns instead of letting it hold the turn open

  Most tools carry no bound of their own, so a read on a dead mount or an MCP call to a process that went away kept a turn running with no output and no error — and the turn's inactivity watchdog could not help, because a tool in flight is deliberately counted as work. Tool calls now have a ten minute backstop, reported to the model as an ordinary tool failure it can react to. Tools that legitimately take as long as they take are exempt (`shell`, `bash`, `question`, `task`), and time spent waiting on a permission prompt is not charged against the tool. Configurable via `experimental.tool_timeout`, `false` to disable.

- Updated dependencies [82bb18a]
  - @reddb-io/redcode-schema@1.19.0
  - @reddb-io/redcode-llm@1.18.19
