---
"@reddb-io/redcode": patch
---

Resolve Bedrock catalog endpoint templates after merging provider, model and credential settings. Configured regions now take precedence over ambient AWS variables, and endpoint resolution uses the native adapter's region defaults. Preserve templates during normalization so later credential configuration can select the correct region.
