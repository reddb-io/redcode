---
"@reddb-io/redcode": patch
---

Polish the todo evidence gate. A goal paused by the loop guard now shows a short reason instead of the model's instructions, and a repeated identical call pauses it too. The read-only command check now sees through `bash -c` and subshells, skips `git -C`, accepts `sed -n`, and ignores a quoted `>`. Windows paths are compared case-insensitively, with drive letters and UNC roots respected. The TUI fold notices any todowrite part that settles late.
