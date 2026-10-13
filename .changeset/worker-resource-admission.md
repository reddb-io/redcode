---
"@reddb-io/redcode": minor
---

Add optional CPU/RAM admission requirements and explicit queued reasons to distributed worker tasks. Keep declared budgets for unfinished or uncertain assignments, share them across slots on the same origin, and respect visible Linux cgroup v2 limits in host measurements. Expose task capabilities and resource requirements in the Desktop worker panel, together with native Session harness queue/steer and interrupt controls using original assignments and idempotent prompt IDs.

Allow cancelling unassigned queued tasks from Desktop or `workers cancel` so impossible resource requirements do not permanently retain a batch. Cancellation never releases uncertain assigned work.
