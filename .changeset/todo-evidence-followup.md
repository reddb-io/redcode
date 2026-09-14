---
"@reddb-io/redcode": patch
---

Harden the todo evidence gate for the TUI runtime: a shell check is recorded on the model's behalf only when the task says what it had to show, and the note quotes its command; relative paths are compared against the session directory; design edits only reopen tasks proven by the same design; a turn whose todowrite calls keep failing now stops after eight; and the TUI folds failed todowrite runs without rescanning finished messages on every streamed token.
