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

This builds the unpacked app (`electron-builder --dir`) in `dist/`. It carries no CLI: it runs the `redcode` of the
installation it ships in. Releases build it in `.github/workflows/redcode.yml`, which ships it in the `vX.Y.Z` Redcode
release beside `redcode`; `redcode desktop` opens it.
