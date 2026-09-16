---
"@reddb-io/redcode": patch
---

todowrite accepts every shape its description asks for. An update that names only a task's id, revision and the fields that changed no longer fails with "Missing key" when the unchanged status is left out; evidence without an explanation is answered with the exact update to resend instead of a schema error; a scopeChange without the message id is linked to the latest request. A schema refusal now names every wrong key and its path on its first line, so the TUI row, the log and `redcode debug todos` show which key failed, and the model corrects its call in one retry. The TUI no longer shows a single todo failure the model fixed on its next call.
