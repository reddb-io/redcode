---
"@reddb-io/redcode": minor
---

Turn a queued prompt into a steer without retyping it

A prompt queued behind a running turn had to wait for that turn to end, even once it became clear it should reach the agent right away; the only way to steer was to type the direction again. A prompt still waiting in the inbox can now change how it is delivered: `POST /session/:sessionID/prompt/:messageID/delivery` with `{"delivery":"steer"}` promotes it at the running turn's next safe step boundary, and `{"delivery":"queue"}` sends a steer back to the queue. Only a pending prompt changes — one already promoted, or removed by a revert, answers 404 — and the change is a durable event, so every client's badge follows it.

In the TUI, pressing the steer key (shift+return) or running `/steer` with an empty prompt while something is queued steers the most recent queued prompt instead of sending nothing; the command palette has "Steer queued prompt" for the same thing, and the busy footer says so while a prompt is waiting. The badge on the message changes from QUEUED to STEER.
