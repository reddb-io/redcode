# Changesets

Every user-visible Redcode change includes a Changesets-compatible Markdown file. The release workflow consumes these entries into one Version PR; merging that PR creates the immutable release tag.

```markdown
---
"opencode": patch
---

Describe the user-visible change.
```

Use `patch`, `minor`, or `major` according to the public impact. The Version PR is the only writer of `package.json` versions.
