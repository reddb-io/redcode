# README screenshot

`workspace.png` was captured on 2026-10-11 from the production web client in `packages/app/dist`,
the renderer shared with Desktop. It shows the real interface at 1440 × 720 in the dark application theme.

The project, sessions, model catalog and planning response are demonstration data supplied through
the existing `packages/app/e2e/utils/workspace.ts` harness. No personal sessions, credentials,
running user servers or model requests were used.

For an updated capture, build `packages/app`, serve its `dist` on an isolated loopback port, and
use `mockWorkspace` / `openSession` with a demo project before taking the Playwright screenshot.
Keep the caption identifying the demonstration data and preserve the interface's actual design system.
