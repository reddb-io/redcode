---
"@reddb-io/redcode": minor
---

Restore Enter-steers and Alt+Enter-queues on the V2 engine. While the agent works, Enter steers: your prompt reaches the agent at its next step. Alt+Enter (`prompt.queue`, in every encoding: kitty `CSI 13;3u`, modifyOtherKeys `CSI 27;3;13~`, and `ESC CR` once the terminal has reported Shift+Enter on its own) or the new `/queue <text>` command queues it for after the turn instead; `<leader>return` still queues too. When the session is idle, Enter and Alt+Enter both just send. With an empty prompt, Enter steers the most recently queued prompt. The busy hint reads `enter steer · alt+enter queue`, or names `/queue` where Alt+Enter may not arrive. Mini follows the same keys and `/queue`. In the web app Enter steers, and Alt+Enter (like Mod+Enter) or `/queue <text>` queues; the submit hint now shows Alt+Enter.

The new `prompt.steer` keybind is unbound by default; a config that still sets `"input_steer": "alt+return"` keeps Alt+Enter steering, and V1 `input_queue` and `input_steer` settings migrate to `prompt.queue` and `prompt.steer`. `redcode run`, ACP and SDK callers are unchanged: a prompt without a delivery still steers.
