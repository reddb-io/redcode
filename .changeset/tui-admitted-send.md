---
"@reddb-io/redcode": patch
---

The TUI now sends a prompt once it is admitted instead of waiting for the whole turn: each submit names its own message ID, a transient failure is retried with that same ID (so a lost response never becomes a second copy), and a send that fails keeps the text in the prompt. A queued prompt left behind by an interrupted or failed turn, or by a restart, is no longer slipped into a later conversation: it is held until you send or discard it with `/pending`, which lists every prompt still waiting in the session. New routes `GET /session/{id}/prompt` and `DELETE /session/{id}/prompt/{messageID}` list and discard pending prompts.
