---
"@reddb-io/redcode": minor
---

One `/goal` command replaces the five goal entries in the TUI slash menu. `/goal <objective>` sets a goal, `/goal pause|resume|drop|status` and `/goal budget $5` (or `5$`, `200k tokens`, `40 turns`) control it, and `/goal` alone shows the goal's status with the actions that apply. A goal budget in turns sets its step budget: `40 turns` lets the goal use 40 model steps. In dual reasoning, other text is read by System One in any language ("pausa isso por enquanto"), and the TUI asks when the reading is unsure, never dropping or replacing a goal below 85% confidence without confirmation. Without System One the text becomes the goal when none is unfinished, and the TUI asks otherwise. `/goal-pause`, `/goal-resume`, `/goal-drop` and `/goal-budget` keep working when typed, hidden from the menu. The new `POST /api/experimental/session/:sessionID/goal/command` reads a `/goal` text without acting on it.
