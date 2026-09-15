---
"@reddb-io/redcode": minor
---

TUI steering: enter sends a prompt queued behind the running turn, and while the agent works shift+return (`input_steer`) or `/steer <text>` steers it instead — the direction reaches the agent at its next step without interrupting the running tool. On an idle session shift+return still inserts a newline, and a config that puts the steer key on `input_newline` keeps it a newline. Pending steers show a STEER badge, promoted ones are marked as steered, and the busy footer hints both keys. A queued prompt now runs before a todo continuation or goal continuation instead of waiting for the goal to finish; the goal stays active and resumes afterwards.
