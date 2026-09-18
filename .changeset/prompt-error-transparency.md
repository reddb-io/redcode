---
"@reddb-io/redcode": patch
---

Unexpected server errors are transparent now. The 500 body carries the real cause's first line, the `err_xxxxxxxx` correlation ref and the exact log file (`~/.red/code/data/log/redcode.log`) instead of a bare "check server logs for details", so a failed prompt can be diagnosed from what the UI already shows. The response never includes the stack.
