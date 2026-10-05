---
"@reddb-io/redcode": patch
---

Stop models from polling CI in a shell loop. When a wait cannot become a native monitor probe (a pull request check, a deploy, a job status), the refusal now hands over the same command with `background: true`, which releases the turn and resumes the session when it exits, instead of suggesting a `for i in 1 2 3 4 5` loop. A refused to-do update now says in plain words what to fix (for example that a task has no observable acceptance criterion) instead of listing question ids.
