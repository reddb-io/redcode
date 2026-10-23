---
"@reddb-io/redcode": minor
---

Require explicit provider configuration and saved connection choices instead of detecting credentials, regions, accounts or endpoints from ambient environment variables. Removing a saved credential no longer falls back to an environment key. Preserve user-declared configuration references and explicitly selected, declared bindings. Catalog endpoint placeholders require explicit settings. SAP AI Core requires an explicit destination or serviceKey and preserves its legacy bridge only for an explicitly configured key.
