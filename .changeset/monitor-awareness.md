---
"@reddb-io/redcode": patch
---

Monitors are transparent and their results know when they stopped mattering. A monitor recovered after its runtime died is settled as `expired` (or `interrupted` when the loss was mid-flight) and its result is queued for the session instead of being silently suppressed, with `monitor.started` / `monitor.finished` / `monitor.expired` events on the session bus. The queued result carries the origin state - tasks closed and newer instructions since the monitor started - and the wake is skipped when the person has already spoken, so a session is never woken for an observation their newer instructions superseded. The probe instructions now teach pointing the success condition at the final state that matters and sizing `interval_ms` as the check budget.
