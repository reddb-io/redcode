# Design raster responsiveness

From `packages/core`, run:

```sh
PLAYWRIGHT_BROWSERS_PATH=/path/to/existing/playwright-cache bun run --preload ./test/preload.ts ./test/performance/design-raster.ts
```

This uses the actual Design renderer, a temporary database/project, Chromium and a deterministic SVG. It exports four-frame GIFs at 128 and 1024 pixels, then repeats both after startup. It reports output bytes, total duration and backend event-loop heartbeat gaps. It does not measure terminal input latency. Use an idle host and compare repeated warm runs; startup and competing CPU work can dominate this measurement.

PNG decoding, quantization, GIF encoding and screenshot comparison run in a scoped raster worker. At most one frame request is outstanding per rendering job. GIF input is limited to 250 frames at 1024 pixels, and encoded output to 100 MB. Cancellation terminates the worker. Release builds embed its bundled entrypoint.

Design publishes authorize resolved source, CSS and asset dependencies before bundling. Vite environment files, automatic PostCSS configuration and inherited TypeScript transforms are disabled. Sass/Less/Stylus require compiled CSS; escaped or dynamic `new URL(..., import.meta.url)` forms require explicit asset imports so the dependency can be authorized.
