---
"@reddb-io/redcode": patch
---

Alt+Enter now steers in terminals and multiplexers that send it as a bare ESC CR (zellij without the kitty protocol, tmux) once the terminal has sent Shift+Enter as `CSI 13;2u` or `CSI 27;2;13~`, or from the start when `input_newline` does not list `alt+return`. The busy hint names `alt+return` as soon as the key works.
