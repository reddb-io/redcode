---
"@reddb-io/redcode": minor
---

TUI steering: while a session is working, enter now queues the prompt behind the running turn, and shift+return (`input_steer`) or `/steer <text>` steers it — the direction reaches the agent at its next step without interrupting the running tool. Pending steers show a STEER badge, delivered ones are marked "steered mid-turn", and the busy footer hints both keys. `shift+return` is no longer a default `input_newline` key (ctrl+return, alt+return and ctrl+j still are).
