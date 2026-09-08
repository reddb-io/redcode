# Design studio

Design is a SessionV2 workflow for creating interfaces and evolving existing applications. It produces interactive prototypes, records review decisions, and hands an immutable approval package to Plan. Build remains responsible for production changes.

## Entry points

- App and desktop: open **Design** from session commands. A completed `design_preview` opens its design once; subsequent revisions do not reopen a closed tab.
- TUI: `/design` offers the `redcode design` command for a separate SessionV2 terminal. In that terminal, `/review` opens `/api/session/:sessionID/design/review` in the browser. Existing TUI conversations remain on their original session contract.
- Both surfaces use the same native review implementation in `packages/design`. The app mounts it without another review iframe; the standalone server supplies the same function and copy dictionary. Prototype and whiteboard frames have opaque sandbox origins and receive no server credentials.

The intake records the starting point, target application, HTML/React/Solid engine, objective, audience, constraints and references. Creating a document selects the Design agent. Review feedback is admitted through SessionV2 before the browser reports success; it does not wait for a provider response. A configured model is still required for the agent to act on feedback.

## Documents and revisions

SQLite owns document metadata, immutable revisions, feedback receipts, asset provenance and render-job status. Artifact work lives in `.red/code/design/<designID>/work`; content-addressed blobs retain file versions. A snapshot rejects symlinks and escaping paths, with limits of 2,000 files, 25 MB per file and 100 MB total.

Publishing captures source files and document metadata. Component publication builds an isolated Vite bundle immediately, so later changes to application components or installed dependencies cannot change a published preview. Restoring a revision creates a new revision and preserves the approved baseline.

For an existing application, select its directory and reuse its components from a local mounting entry. The entry defaults to `src/main.tsx` and must mount on `#root`. React/Solid resolve from that application's installed dependencies. Simple `compilerOptions.paths` aliases from its `tsconfig.json` are supported. Project Vite configurations and plugins are not executed. Components needing routing, data providers or application services need local fixtures in the mounting entry. HTML uses `index.html` by default.

The Design agent offers three compositions when no direction has been specified. Explicit direction takes precedence. Alternatives use named revisions or separate documents; the review lets the user select and restore them.

## Review and handoff

Notes, selected text, semantic element targets, image attachments and Excalidraw scenes are associated with an exact revision. Drafts persist on the reviewing device. Once submitted, the payload and message ID remain frozen across retries, including a lost HTTP response after admission. Changed payloads reusing an ID are rejected. Steer and queue retain SessionV2 delivery semantics.

Ending a review prevents new notes and publication until it is reopened. Approval captures the published revision, its asset metadata and admitted feedback in `approvals/<revision>.json`. It updates only the marked design section of `plan.md`, preserving manual requirements and tasks, then selects Plan. Repeated approval of the same revision preserves its original approval package.

CSS custom-property adjustments preview immediately. **Apply and publish** makes them durable; reset and revision restoration provide reversal. Source discovery records filenames, content hashes, timestamps and whether evidence came from an explicit design document. Refresh source evidence before relying on changed project files. Published revisions retain their original provenance. The review marks evidence that differs from the refreshed document.

Whiteboards reuse the pinned Excalidraw/Mermaid distribution and preserve editable `.excalidraw` scenes plus PNG review attachments. Keep Mermaid source in `data-mermaid-source` for reliable selection after SVG rendering. The bundle is loaded on demand from `REDCODE_WHITEBOARD_DIR`, a checkout build, or the matching release download. Build it from `packages/redcode` with `bun run build:whiteboard` when using an unreleased checkout.

## Images through connected tools

`design_media` lists tools with explicit image capability declarations. `design_generate` executes a selected tool through the canonical registry and imports inline image results as local assets. `design_asset` imports an existing result. Original bytes, source tool, parent version and content hash are retained. Raster images are decoded before storage; SVG accepts CSS/SMIL while rejecting executable elements and external resources. Assets are limited to 10 MB; raster dimensions to 8192 × 8192.

MCP uses the standard SDK with local stdio and remote Streamable HTTP transports, including paginated tool discovery. Existing server headers carry authentication; an OAuth browser-consent flow is not introduced here. Declare capability metadata for the server's actual tool name:

```json
{
  "mcp": {
    "servers": {
      "images": {
        "type": "local",
        "command": ["your-image-mcp"],
        "media": {
          "create_image": {
            "operations": ["generate", "edit", "reference"],
            "formats": ["image/png", "image/webp"],
            "transparency": true
          }
        }
      }
    }
  }
}
```

Effect and Promise V2 plugins register through `context.tools.register`. Each specification supplies `description`, `inputSchema`, optional `media`, and an async `execute(input, { sessionID, signal })`. Results contain text or base64 image content. Registrations disappear when their plugin scope closes; stale materializations cannot execute removed tools. Permission checks remain in execution leaves. There is no separate image execution registry or direct provider billing integration.

## Local exports and checks

`design_export` starts a persisted job; `design_jobs` reads progress or cancels it. Completed files are downloadable from the review and generated API clients. Interrupted jobs require an explicit new request. Provider operations are never automatically repeated by the renderer.

| Output  | Behavior                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTML    | Embeds local scripts, styles, CSS imports, images, font URLs and responsive image candidates. External resources and unbundled JS imports must be localized or bundled first.                                                        |
| GIF     | Captures an editable SVG at deterministic CSS/SMIL times and encodes frames locally. The original SVG remains available.                                                                                                             |
| Audit   | Exercises declared click/fill/press scenarios at 390, 768 and 1440 px; records state assertions, layout findings, keyboard entry, axe WCAG findings and screenshots.                                                                 |
| Compare | Freezes a built application directory and exercises approved scenarios against both versions at the three widths. Reports screenshots, state mismatches and pixel-change percentages. It does not automatically approve differences. |

GIF defaults are 3 seconds, 20 fps, a 512 px longest edge and infinite repetition. Limits are 10 seconds, 25 fps and 1024 px. Aspect ratio is retained. Transparency is optional and uses GIF's binary alpha; gradients and fine antialiasing may lose quality because GIF has a limited palette. Continuous loop is `repeat: 0`; `repeat: -1` disables repetition. Background colors use hexadecimal notation.

Chromium is installed on the first renderer operation when unavailable. Set `PLAYWRIGHT_BROWSERS_PATH` to reuse a managed installation. Image generation depends on connected tools; SVG generation and GIF encoding need no video provider.

For comparison, run `design_export` with `format: "compare"`, the approved `revision`, and `implementation` pointing to a built directory relative to the target application (default `dist`, containing `index.html`). Source code requiring a dev server must be built first.

## Compatibility and validation

Design's V1 agent, tool registrations and `/design/*` routing are removed. Old design sessions are not adapted or migrated. JSON remains at established HTTP/MCP and SQLite boundaries and in portable Excalidraw/approval files; the new design workflow does not introduce a second wire protocol.

Validation lives in `packages/core/test/design.test.ts`, `packages/core/test/plugin/design-tools.test.ts`, `packages/core/test/mcp-design.test.ts`, `packages/server/test/design-review.test.ts`, the existing app preview-selection tests, and the HttpApi code-generation suite. Browser tests use real V2 endpoints, local files, Chromium and a GIF decoder. They exercise admission without a configured provider; they do not claim to evaluate an external model's visual quality or a paid image service.
