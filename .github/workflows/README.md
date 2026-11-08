# Workflow cost policy

Requested by the maintainer on 2026-11-05: keep automatic CI small and make
expensive validation optional. `quick-checks.yml` is the only automatic
quality workflow. It checks changed whitespace, workflow syntax, root/workspace
manifests and this trigger policy on one standard Ubuntu runner, with a
three-minute limit. It does not compile products or run full test suites.

Integration/browser tests, coverage, benchmarks, cross-platform matrices and
operational deployments are available through `workflow_dispatch`. They are
not required PR statuses. Recurring validation and watcher schedules are off.
Existing issue/comment routing remains available; releases only react to
intentional version tags, release events or an explicit manual action.
Artifact source/version/checksum and publication checks stay with publication.

## Run an optional workflow

In GitHub Actions, select its workflow, choose **Run workflow**, then select
the branch and inputs. From the CLI:

```sh
gh workflow run <file.yml> --repo reddb-io/redcode --ref main
```

A workflow using `workflow_call` is a component of its parent operation.
Run the parent rather than dispatching a component without its required inputs.
Manual deployment and publication commands retain their existing environment,
identity and version requirements; this policy does not publish anything itself.

## Available workflows

| File | Events |
| --- | --- |
| `models-catalog.yml` | workflow_dispatch |
| `npm-release-diagnostics.yml` | workflow_dispatch |
| `npm-release-recovery.yml` | workflow_dispatch |
| `quality.yml` | workflow_dispatch |
| `redcode-recover-0872.yml` | workflow_dispatch |
| `redcode.yml` | workflow_dispatch |

`quality.yml` selects checks, unit, browser, Windows or coverage independently.
The Windows unit matrix is opt-in. `redcode.yml` is the explicit build/publish
operation; it no longer waits for those optional suites.

The extra built-binary Design smoke is selected with `run_smoke` on the
manual release operation. It gates publication only when explicitly selected.

## Platform switches

Multiplatform workflows declare `ENABLE_*` variables in their top-level `env`.
Values must be `true` or `false`. Repository Actions variables with the same
names override the workflow defaults, so platforms can be changed without a commit.

| Variable | Default |
| --- | --- |
| `ENABLE_LINUX_X64` | `true` |
| `ENABLE_LINUX_ARM64` | `true` |
| `ENABLE_WINDOWS_X64` | `true` |
| `ENABLE_WINDOWS_ARM64` | `false` |
| `ENABLE_MACOS_X64` | `false` |
| `ENABLE_MACOS_ARM64` | `false` |
| `ENABLE_LINUX_ARMV7` | `false` |
| `ENABLE_LINUX_X86` | `false` |

`x64` means x86_64; `ARM64` means aarch64. glibc/musl and baseline variants
follow their OS/architecture switch. A flag only enables targets already supported
by that workflow; it does not add new build targets. Older tags keep their original
workflow configuration.

The lightweight `Select platforms` job filters matrices before platform runners
are allocated. Disabled platforms create no build/test runner. All native
platforms can be disabled; jobs that require their artifacts then skip. Portable
web packages and platform-independent orchestration keep their existing behavior. The
three-minute automatic Quick checks policy and manual heavy-suite triggers remain.

Example (change only future runs):

```sh
gh variable set ENABLE_MACOS_ARM64 --body true
gh variable set ENABLE_WINDOWS_ARM64 --body false
```

Inspect the `Select platforms` job summary to see the effective selection.

Select `preview_platforms: true` in Run workflow to execute only the lightweight
platform selector. Builds, tests and publication are all skipped in this mode.


## Company workers

Reviewed main workflows use `reddb-public-linux-x64` for Linux-hosted Zig
sidecar cross-compilation, the Design web bundle, lint/typecheck and vault
coverage. Only `reddb-io/redcode` at `refs/heads/main` selects that runner.
The GitHub runner group separately restricts admission to these two workflow
paths on main. Forks, PR refs, tags and other branches are excluded.

One public job at a time shares the existing two dedicated CI nodes with
red-ui/red-router and the private CI group; at most two jobs execute in total.
Each public job has 3 CPU, 12 GiB RAM and an 8 GiB workspace, with no privileged
container or Docker socket. The explicit setup action installs build tools and
zstd in each disposable Ubuntu runner before the existing pinned Bun setup.

Native desktop builds/tests, browser and service lifecycle checks, the final
multiplatform assembler, release planning and publishers remain hosted.
The assembler alone uploaded about 3.45 GB of native packages and 3.11 GB of
release archives in a qualified run, before desktop inputs and dependencies;
it needs a separate disk qualification before moving to the 8 GiB workspace.
Platform switches, native target coverage and publication gates are preserved.

Dispatch `redcode.yml` with `workers_only=true,publish=false` to qualify the
sidecars and Design bundle without allocating desktop jobs, assembling archives
or publishing. This has its own concurrency group and does not cancel or join
an active release. Dispatch `quality.yml` with `suite=workers` to run the
lint/typecheck and vault coverage jobs. Normal release dispatches leave
`workers_only=false` and continue to require their existing verification gates.
