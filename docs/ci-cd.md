# Redcode CI/CD

Redcode uses **one workflow**, `.github/workflows/redcode.yml`, owned by
`reddb-io/redcode`. It publishes `@reddb-io/redcode`, its native packages and the
design app packages that ship with them to npm, and the release archives, which
also carry the desktop app, to GitHub.
It does not call workflows or consume release versions from another repository.

## Push to main

Every push runs:

- Changesets release-plan validation.
- Workflow syntax, lint, types and generated-client checks.
- Redcode product contracts on Linux and Windows.
- Compiled background-service startup and shutdown checks on both platforms.
- Secret-handling tests and vault coverage (90% lines and functions, 75% lines per file).

The product contracts are listed in `script/test-redcode.ts` and run from their
package directories. They cover Redcode behavior changed by the migration rather
than automatically repeating every inherited upstream suite. No local test run is
required. They include stop-loss, goal judgment, S1 classification and reviews,
model recommendations, provider connection, native compaction, subagents and
Design contracts. Pull requests, if explicitly requested, use the same checks.

The separate check, test, Nix and Storybook workflows have been removed. Their
product source remains available. Inherited automation archived under
`.github/upstream-workflows` is inactive.

## SemVer releases with Changesets

1. Include a `.changeset/*.md` entry for `@reddb-io/redcode` in each user-visible
   change, selecting `patch`, `minor` or `major`.
2. Dispatch the same workflow on `main` with `publish=true`.
3. Changesets consumes the entries, updates the product manifest and changelog,
   and commits the version directly to `main`. No release branch or Version PR.
4. Checks and tests validate that exact versioned commit. In parallel, build
   the RPC sidecars and the Design app, then Redcode's native packages, which
   `bun run assemble` pairs with the Design app of each target.
5. Run the smoke against the exact Linux archive, which carries the Design app
   beside `redcode`, in a fresh home with a scripted provider. It checks the service, tools and token
   accounting, temporary worktrees, vault isolation from model requests and outputs,
   and the browser review. Its failure blocks publication.
6. After lint/types, product contracts, vault coverage, builds and the smoke pass,
   publish to GitHub and npm in independent jobs of this same workflow. GitHub
   verifies downloaded assets, checksums, CLI/Design versions and protocol before
   making the release public. npm publishes every platform package before the main
   package and verifies anonymous registry availability and an isolated install.
7. The final release status reports each destination. Both jobs must succeed for
   the complete release to pass; a blocked npm publication does not hold back
   verified GitHub binaries.

```sh
# Validate and build the candidate without publishing or changing main:
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=false

# Version, validate, build and publish:
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=true
```

The optional `version` input asserts the Changesets result; it never overrides
SemVer. With no pending changesets, publication can retry the current version.
Existing tags must point to the selected commit. Failed validation prevents npm
and GitHub publication; a version commit already pushed remains on main.

Manual dry runs compute the planned version without committing it. Candidate
builds receive that version through the build environment. Push/PR validation
uses the current manifest version and never consumes changesets.

Release runs are serialized and cannot cancel each other. Superseded push/PR
checks can be cancelled. Every release job checks out the version job's exact
SHA, including when `GITHUB_TOKEN` prevents a second push-triggered run.

## Credentials and release artifacts

- `NPM_PUBLISH_MODE`: repository/environment variable, `token` (default) or `oidc`.
- `NPM_TOKEN`: publication credential for `token` mode. Its identity is checked
  before native artifacts are downloaded. npm may prefer a configured trusted
  publisher; this mode permits the existing token fallback.
- `RELEASE_PAT`: optional existing GitHub write identity, with `github.token`
  fallback. No duplicate or upstream credentials are needed.
- `red-release`: existing publication environment.
- Only version preparation and GitHub publication have contents write permission;
  npm publication has `id-token: write` for trusted publishing and provenance.

The npm job pins npm 11.20.0. In `oidc` mode it supplies no `NODE_AUTH_TOKEN`, so a
misconfigured trusted publisher cannot silently fall back to a long-lived token.
Public registry/install checks also run without the publication token. Registry
lookups use `--prefer-online`; only `E404` or `ETARGET` means a version is absent.
Authentication, rate-limit and network errors stop publication with their cause.

Before setting `NPM_PUBLISH_MODE=oidc`, configure a trusted publisher for the main
package and all 24 platform packages on npm (12 `@reddb-io/redcode-<target>` and
12 `@reddb-io/redcode-design-<target>`), with organization `reddb-io`, repository
`redcode`, workflow filename `redcode.yml` and environment `red-release`. Enable
the allowed action for direct `npm publish`; a publisher limited to staging still
requires manual approval. See https://docs.npmjs.com/trusted-publishers.

Updating a token does not release an already staged version. Approve that version
with maintainer 2FA in npm's Staged Packages tab, then rerun the failed npm job.
The publication script skips versions that are already live and identifies a
staged `E409` separately from ordinary registry propagation delays.

The native packages retain all supported targets and RPC sidecars. The Design app
ships in the same `vX.Y.Z` release: every archive carries `redcode-design` beside
`redcode`, each `@reddb-io/redcode-<target>` package has its
`@reddb-io/redcode-design-<target>` package as an optional dependency (so pnpm's
isolated layout links it next to redcode), and the release carries the whiteboard
bundle the design app downloads. Linux and macOS archives are `tar.gz`; Windows
archives are `zip`. Separate `design-vX.Y.Z` releases are no longer published.

The desktop app ships only in the release archives, and so with mise: every
archive except Linux musl carries the unpacked app under `desktop/` beside
`redcode`, taken by `bun run archive` from `REDCODE_DESKTOP_DIST`. npm carries
the CLI and the design app only. At about 0.2 GB per platform the registry
rejects a desktop package (`E413 Payload Too Large`), so there is none, and
`redcode desktop` in an npm install points to mise or the release archives.

Builds, checksum verification, CLI identity/agent checks, service lifecycle and
published installation checks remain required. Artifact compression is disabled
for already compressed archives and native binaries.

Failed compiled-service lifecycle checks print the original error before the
diagnostic output and upload `service-smoke-linux` or `service-smoke-windows`.
These artifacts contain the failure and each contender's stderr plus the service
log when available; no service registration or credential files are uploaded.

## Optional inherited tests

For an upstream migration investigation, the same workflow can run the full
inherited workspace unit suite instead of the focused product contracts:

```sh
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=false -f upstream_full=true
```

This does not enable separate browser, Nix, marketplace or upstream deployment
pipelines. Full lint and type checks still cover workspace integration. See
`migration-parity.md` for remaining feature parity work; CI success alone does not
prove visual parity. Compare completed run durations before claiming a specific
build-time reduction.

## Stop-loss calibration

Use `redcode debug guards --days 7` against the running service to inspect signals,
S1 dismissals, hints followed by progress and stopped turns. `--json` includes
the recorded intervention details. Compare the same usage period after an update;
old trips alone cannot validate a new calibration. These are intervention counts,
not a measured false-positive rate or proof that a hint caused progress.

The spend clock excludes the union of recorded tool-execution intervals after
the last progress. Older history without execution timestamps uses wall time.
The external-job wait budget always uses wall time, including tools, so repeated
status checks still expire even when each command takes a long time.
