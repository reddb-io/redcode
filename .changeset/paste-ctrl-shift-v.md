---
"@reddb-io/redcode": patch
---

Ctrl+Shift+V now pastes from the clipboard like Ctrl+V. Under the kitty keyboard protocol, terminals and multiplexers such as zellij forward it as a key instead of pasting, and dictation tools emit it, so it did nothing before. A terminal that forwards the key and also pastes no longer inserts the text twice.
