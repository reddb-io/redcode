# Inactive upstream workflows

These files are retained for upstream comparison only. GitHub Actions loads
workflows from `.github/workflows`, so this directory does not run them.

The active release owner is **reddb-io/redcode**. Do not copy these files back into
the active directory without adapting product targets, credentials, branch names,
and behavior to Redcode. Several scripts they call still intentionally describe
upstream OpenCode infrastructure.

The archived `setup-git-committer` action requires the upstream GitHub App. The
archived `CODEOWNERS` file names upstream reviewers and must not govern Redcode.
See `docs/ci-cd.md` for the complete audit and the active release flow.
