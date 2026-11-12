# Redcode Creator

Use Creator to build interactive artifacts and author Redcode extensions. This guide adapts the
creation workflow to Redcode's own APIs; DeepSeek Harness bundles, Cordis Slots and its
`plugin_manager` are different APIs and do not run here.

## Choose the output

- Interactive app, dashboard, shader, 3D scene, editor or visual explanation: use the existing
  Design document runtime for a preview that can execute the artifact's JavaScript.
- Local tools and server/TUI plugins: author a package against the current Redcode plugin SDK.
  Package source is a deliverable; activation is a separate operation.
- Reusable agent workflow: author a skill with a `SKILL.md` and narrowly scoped references.
- Native desktop/web GUI contribution: inspect the GUI extensions SDK. Production builds
  currently load built-in GUI definitions; they do not hot-install arbitrary generated GUI code.
  Deliver reviewed source or an isolated interactive preview and explain this distinction.

## Interactive artifacts and procedural 3D

1. Read the actual schemas of `design_document`, `design_preview`, `design_read`, `design_asset`,
   `design_export` and `design_jobs`. Inspect existing documents before creating another one.
2. Create a document with the appropriate engine and kind. Follow its design-system discovery
   and configuration flow. Use the returned work root and entry instead of guessing a path.
3. Implement a complete first interaction, then publish with `design_preview`. Continue revisions
   under the same document ID. Preserve user changes and recorded feedback.
4. Use the document's preview, rendering jobs or an attached browser to exercise controls and
   inspect failures. Record the revision and the evidence. An export job has not succeeded until
   its result arrives; use its native monitor rather than repeatedly polling.
5. Deliver the revision/preview and any actual exported files. A creative artifact does not need
   `design_exit` or a Plan handoff unless the user wants to integrate it into product code.

For 3D, inspect the project dependencies and connected tools. Prefer procedural geometry,
WebGL or an already available Three.js stack for scenes that do not require generated models.
Do not assume Three.js, Blender or a text-to-3D service is installed. Request the specific missing
capability when necessary. Import only assets the user supplied or authorized; do not invent a
download, license, API result, model URL or export file. Explain the supported output formats
of the actual tool used. A rotating scene is not evidence of topology, rigging or export quality.
`design_asset` imports supported image formats, not GLB/glTF models. Do not send 3D binaries to
an image import tool. Inspect the runtime's supported asset path or publish the binary separately
with `session_artifact`; verify model loading in the actual interactive preview.
The isolated preview blocks network connections. Bundle libraries and model data into the
artifact using supported local build inputs or data URLs; do not rely on runtime CDN imports,
remote model fetches or embedded API keys. Keep that isolation intact.

Pause animation when the preview is hidden. On disposal, cancel animation frames, disconnect
observers, remove event listeners, unsubscribe streams, dispose geometries/materials/textures
and the WebGL renderer, and revoke temporary object URLs. Bound caches and reuse the existing
preview rather than opening another browser tab for every revision.

Delivery's file preview intentionally disables scripts and external resources. Use it to inspect
and distribute files, not as an interactive 3D runtime. Keep its content security policy intact.

## Plugin authoring

Inspect the current [plugin SDK](https://github.com/reddb-io/redcode/tree/main/packages/plugin)
and its public examples before selecting the entry point. Server, TUI and RPC entries have
different hosts; a server plugin cannot access the desktop DOM. The execution host is the
connected server or worker, which can be a different computer from the desktop client.
Prefer source and SDK documentation matching the installed release when available. The linked
main branch can be newer; verify its contracts against the actual host before using an API.

Keep generated source in a user-selected workspace directory, or a dedicated
`.red/code/creator/<name>` directory in that workspace. Do not modify user configuration merely
because source was created. Package installation can execute arbitrary host code; show the
package, entry point, scope and required access before activation. Respect existing permissions
and explicit user authorization. Never create connections from ambient environment variables.

Use the location-scoped registry and its documented lifecycle. Register tools with schemas and
permission checks at the execution boundary, and verify a real call. Dispose registrations and
other resources with the plugin's lifetime. Reuse existing MCPs and tools instead of creating a
duplicate integration. Preserve saved connections and credentials.

## Skill authoring

A skill is a directory containing `SKILL.md` with YAML frontmatter (`name` and a specific
`description`) and Markdown instructions. Describe when to use it, its inputs, operations,
verification and failure states. Keep optional implementation detail in references. Reading a
skill never grants permissions to execute its instructions. Use Redcode's documented project
skill directory or the user's explicitly selected installation scope; a draft is not installed.

## Completion evidence

Report the artifact/package path, preview or revision, the interaction or tool call actually
verified, and remaining limitations. Use only existing authorized data sources for dashboards.
Do not claim a generated UI plugin is loaded, a remote model was called, an export completed or
a skill is active without checking its runtime state. Missing access or a dependency should
produce a concrete next step, not a fictional success message.
