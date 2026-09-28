# Redcode Changesets

Record each user-visible change here with `bun run changeset`, or write a Markdown
file like this:

```md
---
"@reddb-io/redcode": patch
---

Explain the user-visible fix and any migration instructions.
```

Use `patch` for fixes, `minor` for compatible features, and `major` for breaking
product changes. The OpenCode base version does not set Redcode's release version.
All Redcode surfaces ship under the product release; only `@reddb-io/redcode` is
versioned by Changesets. Internal upstream packages keep their existing versions.

`bun run release:status` previews the accumulated release. The manual `redcode`
GitHub Actions workflow consumes the changesets on `main`, writes the product
version and changelog, validates that commit, and publishes its verified artifacts.
No release branch or Version PR is created. See `docs/ci-cd.md` for the complete flow.
