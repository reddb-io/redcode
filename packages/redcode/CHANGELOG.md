# @reddb-io/redcode

## 0.59.4

### Patch Changes

- Wait for plugin activation before listing agents from a newly started server, so `agent list` and `debug agents` include Redcode's built-in and configured agents on their first request.

## 0.59.3

### Patch Changes

- Restore Redcode's S1/S2 setup and evaluation history, Design conversation commands,
  and voice dictation into the composer after the OpenCode V2 migration. Preserve
  Redcode branding and the `/mcp` shortcut. Remove inherited upstream automations
  from the active CI/CD workflow set.
