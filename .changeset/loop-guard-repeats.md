---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
---

Notice a call that never stops being made, even when the answer keeps changing

Comparing results is what keeps the loop guard off polling's back, and it was also the way through it: an answer carrying a timestamp, a pid or a temporary path never repeats byte for byte, so the same call could run all turn without ever counting as repetition. At twelve identical calls in a row the repetition is mentioned once — the call still runs, because polling looks exactly like this and is sometimes right. Configurable as `experimental.loop_guard.nudge_at`.
