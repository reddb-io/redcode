# Redcode CI/CD

## Ownership

The repository and release destination are **reddb-io/redcode**. Redcode publishes
`@reddb-io/redcode` and its native platform packages. OpenCode is the technical
upstream, not our release owner, infrastructure account, or product version.

The review followed the local patterns in `../dit`, `../red-skills`, and
`../redskilled`: explicit ownership, read-only validation, scoped publishing
permissions, pinned tools, reviewed release notes, and verification of packaged
artifacts and registry availability. Their Rust release engine, content-only
pipeline, and Version PR branches are not required by this repository.

## Active workflows

| File            | Responsibility                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `check.yml`     | Existing `typecheck` check; lint/types, workflow syntax and destination checks, Changesets plan validation    |
| `test.yml`      | Linux/Windows Redcode contracts, compiled service lifecycle and generated client; full upstream suite by manual request |
| `redcode.yml`   | Manual Changesets versioning, release checks, native builds, Design app, sidecars, npm and GitHub publication |
| `nix-eval.yml`  | Read-only flake evaluation on `main`; existing Nix output names remain compatibility identifiers              |
| `storybook.yml` | Storybook build for relevant changes on `main`                                                                |

Existing workflow and check names remain stable. All branch triggers use `main`.
Checks use `contents: read`; only release preparation and publication can write
contents. The publisher also has `id-token: write` for npm provenance.

The release entry point checks both the exact repository and `refs/heads/main`.
Every release build and validation job checks out the SHA selected by the version
job. GitHub tags target that same SHA. All release versions share one concurrency
group so separate releases cannot publish simultaneously.

## Changesets release flow

1. Add a Markdown Changeset for `@reddb-io/redcode` with a patch, minor, or major
   increment and a user-facing explanation. Commit it with the source change on
   `main`. `bun run changeset` invokes the pinned Changesets CLI `3.0.3`.
2. `bun run release:status` shows the accumulated release plan. Only the Redcode
   product package is versioned; upstream workspace packages are ignored.
3. Dispatch `redcode.yml` on `main`. With `publish=false`, the workflow computes
   the next version and validates/builds the candidate without pushing a version
   commit or publishing. Candidate builds use the planned version through the
   existing build environment; the checkout remains the source SHA.
4. With `publish=true`, the version job consumes the changesets, updates
   `packages/redcode/package.json`, `packages/redcode/CHANGELOG.md`, and `bun.lock`,
   and commits them directly to `main`. No release branch or Version PR is created.
5. Checks, Redcode contract tests, native builds, sidecar checks, and Design smoke
   checks validate that versioned SHA. Failed validation stops publication; the
   version commit stays on `main` for diagnosis and repair.
6. The publisher creates draft GitHub releases, uploads archives and checksums,
   publishes platform npm packages before the main package, waits for registry
   visibility, and verifies an isolated install. It then publishes the GitHub
   releases with the corresponding Changesets changelog section.

The optional `version` input is an assertion, not a version override. It must
equal the version calculated from the changesets. A run without pending changesets
can retry the current version; existing tag checks reject a different commit for
an already tagged version. If source fixes land after a failed candidate, include
a new changeset as appropriate before the next release.

```sh
# Rehearse without publishing or changing main:
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=false

# Publish after reviewing the release intent:
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=true
```

GitHub's `GITHUB_TOKEN` does not trigger push workflows for its own commits. The
version job prefers the existing `RELEASE_PAT` when available and otherwise uses
`github.token`; the release's own checks/builds explicitly select the versioned
SHA in either case. This flow does not depend on a tag push starting another
workflow.

The Redcode manifest starts from the verified public release `0.59.2`, independently
of the upstream `2.0.18` workspace baseline. The initial restoration changeset
requests a patch release. Migration completeness is tracked separately in
`migration-parity.md`.

## Credentials

- `NPM_TOKEN`: existing organization/repository credential for `@reddb-io` npm
  publication. Do not create an upstream-scoped token or duplicate secret.
- `RELEASE_PAT`: existing optional GitHub push/release identity; `github.token`
  remains the fallback supported by this workflow.
- `red-release`: existing publication environment. Its live protection settings
  are GitHub configuration, not guaranteed by this file.
- No active workflow requires `OPENCODE_APP_SECRET`, `OPENCODE_API_KEY`, Anomaly
  Cloudflare/AWS credentials, or their marketplace publisher accounts.

## Archived workflows: complete review inventory

All 23 inherited workflows below are retained in `.github/upstream-workflows`,
outside GitHub Actions discovery. Their source and supporting product packages
remain available for comparison and later deliberate adaptation.

| Files                                                                          | Reason                                                                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `close-issues.yml`, `close-prs.yml`                                            | Upstream issue/PR housekeeping; `close-issues` actually failed trying to comment in `anomalyco/opencode` with HTTP 403       |
| `compliance-close.yml`, `pr-standards.yml`, `pr-management.yml`                | Upstream contribution policy, reviewer/team assumptions, automatic comments and closure; some read the upstream `dev` branch |
| `triage.yml`, `duplicate-issues.yml`, `opencode.yml`, `review.yml`             | Upstream AI bots, installer, API keys, and comment/review side effects                                                       |
| `docs-update.yml`, `docs-locale-sync.yml`                                      | Upstream AI documentation automation and GitHub App identity                                                                 |
| `deploy.yml`, `deploy-files.yml`, `deploy-posts.yml`, `deploy-www.yml`         | Upstream infrastructure, services, credentials, and deployment branches                                                      |
| `publish.yml`                                                                  | OpenCode CLI/desktop/package publication; replaced by the existing Redcode publisher                                         |
| `publish-github-action.yml`, `release-github-action.yml`, `publish-vscode.yml` | Separate upstream marketplace products and tags                                                                              |
| `containers.yml`                                                               | Upstream container publication from `dev`; no Redcode container release contract has been established                        |
| `nix-hashes.yml`                                                               | Automatic source writes through the upstream GitHub App; read-only Nix evaluation remains active                             |
| `notify-discord.yml`, `stats.yml`                                              | Unconfigured upstream notifications and download statistics                                                                  |

The old app-token composite action and upstream `CODEOWNERS` were also archived.
The commented `.github/publish-python-sdk.yml` is outside workflow discovery and
remains inactive.

## Validation and limits

The default test scope is the explicit list in `script/test-redcode.ts`: Redcode's
agent/configuration behavior, migration and database contracts, modified Session
behavior, Design, S1/S2 UI and history, voice input, legacy RPC, sidecar transport,
and npm publication. Tests run from their package directories with their existing
preloads and isolation. Missing contract files fail the runner; `--list` verifies
the manifest without executing tests. Update this list when adding product contracts.

Both Linux and Windows run these contracts on `main`. The release runs the same
selection instead of repeating every upstream workspace test. Generic OpenCode
provider, Core/V2, browser, Node distribution, workerd SDK and codemode publication
suites are excluded from the default path. Their source remains available for
an upstream upgrade investigation:

```sh
gh workflow run test.yml --repo reddb-io/redcode --ref main -f upstream_full=true
```

The regular compiled service smoke omits the embedded web UI build. The actual
release still builds the web UI, every supported native target and Design, checks
the Redcode identity and four agents in the compiled CLI, verifies archive digests,
and installs the published npm package. Artifact uploads use compression level zero
to avoid spending CPU recompressing native binaries and release archives. Full lint,
type checks and generated-client validation remain required.

This narrower scope intentionally relies on upstream coverage for inherited
behavior. It cannot prove that every upstream behavior remains unchanged in our
fork; retain focused contracts wherever Redcode changes that behavior.

The active CI lints workflow syntax with checksum-pinned actionlint `1.7.12` and
rejects upstream automation destinations. Package scopes such as `@opencode/core`,
build variables such as `OPENCODE_VERSION`, attribution, and public compatibility
identifiers are valid technical dependencies and are not renamed by this review.

No local test execution is part of this migration workflow. Checks in GitHub
Actions must pass on the actual commit before claiming a validated release. The
workflow audit does not establish full Redcode feature parity or a measured 50%
build-time reduction. Compare successful run durations before claiming a specific
speedup; test selection and artifact compression reduce work without that guarantee.
