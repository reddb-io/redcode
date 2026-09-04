---
"@reddb-io/redcode": minor
---

Stop turns from stalling or looping in silence: a turn now has a hard step ceiling, a stream that goes quiet is aborted whatever content type it uses, auto-compaction can no longer paste your prompt back into the transcript over and over, the TUI re-reads the session after the event stream reconnects instead of waiting on a message it never received, and the status line says when nothing has arrived for a while rather than spinning as if it were working.
