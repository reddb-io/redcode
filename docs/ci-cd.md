# Redcode CI/CD

Redcode uses **one workflow**, `.github/workflows/redcode.yml`, owned by
`reddb-io/redcode`. It publishes `@reddb-io/redcode` and its native packages.
It does not call workflows or consume release versions from another repository.

## Push to main

Every push runs:

- Changesets release-plan validation.
- Workflow syntax, lint, types and generated-client checks.
- Redcode product contracts on Linux and Windows.
- Compiled background-service startup and shutdown checks on both platforms.

The product contracts are listed in `script/test-redcode.ts` and run from their
package directories. They cover Redcode behavior changed by the migration rather
than automatically repeating every inherited upstream suite. No local test run is
required. Pull requests, if explicitly requested, use the same checks.

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
   Redcode native packages, the RPC sidecars and the Design app.
5. Only after all required jobs pass, publish npm platform packages and the main
   package, verify registry availability and an isolated install, then publish
   the GitHub releases with checksums and Changesets notes.

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

- `NPM_TOKEN`: existing organization/repository npm publication credential.
- `RELEASE_PAT`: optional existing GitHub write identity, with `github.token`
  fallback. No duplicate or upstream credentials are needed.
- `red-release`: existing publication environment.
- Only version preparation and publication have contents write permission;
  publication also has `id-token: write` for npm provenance.

The native packages retain all supported targets and RPC sidecars. The Design
companion retains its existing `design-vX.Y.Z` release assets, which the client
uses to install it. Both releases are produced by this single workflow.

Builds, checksum verification, CLI identity/agent checks, service lifecycle and
published installation checks remain required. Artifact compression is disabled
for already compressed archives and native binaries.

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
