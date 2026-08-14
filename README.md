# Redcode

Redcode is RedDB's terminal coding agent, built from the OpenCode codebase and integrated natively with RedSkills and `redskilled`.

## Install

```bash
npm install -g @reddb-io/redcode
redcode
```

The same package can be installed with Bun, pnpm, or Yarn. It selects the native binary for Linux, macOS, or Windows automatically.

Redcode intentionally publishes only the CLI binary. There are no beta channel, containers, desktop application, package-manager taps, or hosted deployment workflows.

## Development

```bash
bun install
bun dev
```

The default branch is `dev`. Tests must run from the package that owns them rather than from the repository root.

## Releases

Releases follow one path:

1. Run the `red-release` workflow with an exact semantic version.
2. Review and merge the generated Version PR.
3. The merge creates the matching `vX.Y.Z` tag.
4. `red-publish` builds native binaries, publishes `@reddb-io/redcode`, verifies a clean install, and publishes the GitHub Release.

The workflows use the organization-provided `RELEASE_PAT` and `NPM_TOKEN` secrets; `NPM_TOKEN` publishes the public packages under `@reddb-io`.

## Upstream

Redcode is a fork of [OpenCode](https://github.com/anomalyco/opencode). OpenCode is licensed under the MIT License; its copyright and license notices are preserved.
