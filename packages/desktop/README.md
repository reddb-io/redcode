# Redcode Desktop

The Redcode desktop app, built with Electron. It connects to the same Redcode background service as the terminal
client, so sessions started in either show up in both.

## Development

```bash
bun install
bun run dev
```

Development runs against the `redcode` on `PATH`. Overrides:

| Variable                         | Effect                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| `REDCODE_BIN`                    | Executable used to start or join the background service                  |
| `REDCODE_DESKTOP_SERVER_URL`     | Connect to this server directly (`REDCODE_DESKTOP_SERVER_PASSWORD`)      |
| `REDCODE_DESKTOP_USER_DATA`      | Electron profile directory, to run several instances side by side       |
| `REDCODE_DESKTOP_DEBUG_PORT`     | Chrome DevTools Protocol port (default 9222), used by `scripts/shot.ts` |
| `REDCODE_DESKTOP_CHANNEL`        | `dev` (default), `beta` or `prod` identity                               |

## Build

```bash
REDCODE_DESKTOP_CHANNEL=prod bun run package
```

`scripts/prebuild.ts` bundles the Redcode binary for this platform from the latest `redcode-<os>-<arch>` release
archive (`REDCODE_DESKTOP_RELEASE` picks a release, `REDCODE_DESKTOP_BINARY` a local binary or directory) as
`resources/redcode`, with its version in `resources/redcode.version`. Packaged apps stage that binary under the
profile directory before starting the service, so an app update never replaces a running executable.

Releases are built by `.github/workflows/desktop.yml` from `desktop-v*` tags and published beside the CLI releases;
the rolling `desktop-latest` release carries the update feed.
