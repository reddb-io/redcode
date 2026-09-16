---
"@reddb-io/redcode": patch
---

Shift+Enter inserts a newline again when the terminal sends it as `ESC CR`. Since 0.35.1 that byte pair counted as Alt+Enter, so it submitted the prompt when idle and steered while busy. That is what the VS Code and Cursor `sendSequence` binding, Alacritty `chars` mappings and tmux send. A bare `ESC CR` is a newline once more (`input_newline` lists `alt+return` again). Alt+Enter steers, or submits when idle, only when the terminal reports it unambiguously: through the kitty keyboard protocol (`CSI 13;3u`) or modifyOtherKeys (`CSI 27;3;13~`). The newline reports `CSI 27;2;13~` (WezTerm and xterm defaults), `CSI 13;2u` (kitty protocol) and `Ctrl+J` keep working. WezTerm binds Alt+Enter to fullscreen by default, so while the agent works the prompt hint there now shows `/steer`, just as it does in terminals without the kitty protocol.
