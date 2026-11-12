# Creator Mode: integration with the current Redcode architecture

Inspected on 2026-11-12. This document describes source-backed Redcode capabilities and an implementation proposal. The companion DeepSeek study owns upstream feature claims. An API appearing in a TypeScript interface is not evidence that its installation flow ships in packaged Desktop or Web.

## Main conclusion

Redcode can add Creator as its fifth primary agent without inventing another agent harness, persistence model or preview server. It can already author local server plugins, TUI plugins and skills, create interactive prototypes through Design, and publish versioned output through Delivery. That is a useful first vertical slice.

The subsequent implementation adds dynamic installation for isolated renderer-only components.
`creator_component` installs a published Design revision into a persistent project inventory, and
the built-in Creator surface renders the selected enabled component in Desktop/Web. The installed
portable HTML belongs to the component, so it outlives its source conversation and revision.

This does not enable arbitrary privileged GUI archive installation. The desktop archive manager
remains a development tool, packaged builds still block its mutating IPC methods, and native
SDK definitions remain built-ins. Web and remote server clients use the authenticated component
API instead of a desktop bridge. No generated code executes in the host renderer or Electron main.

Creator distinguishes a draft artifact, a verified published revision, an installed isolated panel
and a privileged host extension. Generating HTML alone is not an installation: the project record,
active version and portable snapshot must exist and be verified through the component API.

## Installed component contract

- `schema/src/creator-component.ts` defines metadata, versioned mutations and the update event.
- `core/src/creator/component.ts` owns Location-scoped KV metadata and the existing Design
  blobstore's portable snapshots. Inventories contain no HTML or credentials.
- `creator.component.*` APIs expose the lifecycle through the normal authenticated project scope.
  Installation and update validate the source session's directory and workspace identity.
- The agent's `creator_component` tool checks permissions at execution. Mutating operations
  request approval unless explicitly permitted, and Question remains unable to mutate.
- Updates check `expectedVersion` and package the new revision before replacing the active record.
  Repeating installation of the same source/revision is idempotent. Failed preparation retains the
  last good snapshot. Enable/disable/removal also require the current version.
- `gui-extensions/src/creator` contributes the panel, command and project Plugins settings content.
  The server/project scope comes from Settings, never from whichever chat happens to be active.
- The parent requests HTML with its authenticated SDK, then mounts an opaque-origin `srcdoc`
  iframe with scripts enabled and no same-origin grant. Generated code receives no host bridge.
- The iframe exists only while the enabled component is visible. API work is cancelled on owner
  disposal; inventories refresh through scoped events rather than background polling.
- A controlled bootstrap reports runtime exceptions and rejected promises. The parent accepts
  only schema-valid diagnostics from the current frame's window and opaque origin, and renders
  text/stack details without evaluating them.

This contract is intentionally a panel installation contract. It does not grant arbitrary global
slots, themes, native commands, host tools, credentials or a shared application database.

## Existing mechanisms and their real scope

| Mechanism | Source of truth | Already useful for Creator | Limitation |
| --- | --- | --- | --- |
| Primary agents | `core/src/plugin/internal.ts`, `schema/src/agent.ts` | Add `creator` with its own prompt and policies; clients consume the agent inventory | Registering a mode adds no new tool by itself |
| Built-in skills | `core/src/plugin/skill.ts`, `core/src/skill.ts` | Ship the authoring contract with the binary; no remote skill install needed | A skill is guidance, not an execution or permission boundary |
| Server plugins | `plugin/src/host.ts`, `core/src/plugin/module.ts` | Load a package with a server entry, add tools/skills/hooks; reload watched local sources | Trusted JavaScript executes in the server process |
| TUI plugins | `plugin/src/tui/`, `plugin/src/host.ts` | Existing `./tui` package entry for terminal integrations | A TUI entry is not a Desktop/Web renderer entry |
| RPC plugins | `plugin/src/rpc.ts`, `plugin/src/host.ts` | Expose contract-backed RPC alongside a server plugin | Not arbitrary access to the desktop main process |
| GUI SDK | `gui-extensions/src/sdk/` | Typed panels, commands, settings pages, slots, stores, scoped lifecycle | Shipped renderer composition is static; dynamic GUI archives are incomplete |
| Design | `core/src/design/`, `core/src/tool/plugin/design-*.ts` | Workspace, build, isolated interactive review, immutable revisions, screenshots, feedback, export jobs | Built for reviewed artifacts; not an application plugin installer |
| Delivery artifacts | `core/src/session/artifacts.ts`, `core/src/tool/plugin/session-artifact.ts` | Session-owned snapshots, immutable blob content, revisions and downloads | HTML preview has no scripting; no built-in glTF/GLB viewer |
| Execution capabilities/MCP | `core/src/execution-capability.ts`, `core/src/plugin/agent-tools.ts` | Use connected external modeling/rendering tools when explicitly available | Do not infer Blender, image generation or a remote provider from a mode name |

Paths in the table are relative to `packages/`.

## Current plugin authoring contract

### Three entry points, no GUI entry

`packages/plugin/src/host.ts` resolves server entry points in this order: the package's `server` subpath, then its root entry. It also resolves `tui` and `rpc` subpaths. `packages/schema/src/plugin.ts` reports those features in the plugin inventory; there is no GUI feature in that schema.

`packages/core/src/plugin/module.ts` accepts a default export shaped either as `{ id, setup }` for Promise plugins or `{ id, effect }` for Effect plugins. A local package directory is supported. Configuration stores package targets in `plugins`, either as strings or `{ package, options }` objects. Relative paths are resolved against the directory containing the configuration document, not against a browser's filesystem.

`ConfigPluginSource` observes configuration and local source changes. `PluginModule` adds source watchers, and plugin activation replaces scoped registrations. Cleanup is essential: timers, sockets and background work cannot outlive the plugin generation that created them.

### Small server plugin with no SDK dependency

This is intentionally plain JavaScript. It works without guessing whether an npm-published SDK matches the fork and without installing `effect` into the user's project.

`package.json`:

```json
{
  "name": "creator-echo",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./server": "./server.js"
  }
}
```

`server.js`:

```js
export default {
  id: "creator.echo",
  async setup(ctx) {
    await ctx.tool.transform((editor) =>
      editor.add({
        name: "creator_echo",
        description: "Echo text without side effects",
        options: { codemode: false },
        input: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        async execute(input) {
          return { content: input.text }
        },
      }),
    )
  },
}
```

The real `PluginModule` loader, plugin supervisor and tool registry execute this exact package in `packages/core/test/plugin.test.ts`: the test loads `plugin/fixtures/creator-echo`, activates it, checks the advertised schema, calls `creator_echo`, then unloads it and verifies that the tool disappears. It does not mock the plugin loader or tool invocation.

Activation is distinct from authoring. For a root-level `redcode.jsonc`, a package at `.red/code/creator/echo` could be configured as:

```json
{
  "plugins": ["./.red/code/creator/echo"]
}
```

Do not create the same relative path in a nested config without recalculating its base. Do not place unfinished sources into auto-discovered `plugin` or `plugins` directories: writing a file there can activate it through the existing watcher. Keep drafts in the Creator workspace until the user authorizes installation.

Once installed, server plugins run on the connected server. A remote Linux server does not gain control of the local Windows desktop merely because a plugin defines a tool. Existing permissions, declared connections and execution capabilities still apply.

### Skills

Filesystem skills use Markdown with front matter and a `SKILL.md` entry. Place a project skill in a skill source already configured for that project; inspect the current configuration instead of assuming legacy OpenCode directory names. A minimal entry is:

```markdown
---
name: creator-echo
description: Use the creator_echo tool to check that the local echo extension is active.
---

Call creator_echo with a short text and report the returned text. If the tool is absent, explain that the extension is not active. Do not edit configuration or install dependencies merely to run this check.
```

For the bundled authoring skill, use the existing `SkillPlugin` registration mechanism: `Skill.Info`, `Skill.uri` and embedded content. Do not add a separate downloader, skill registry or hidden provider. A plugin can also register skills through `ctx.skill.transform`; its registrations disappear when it unloads.

## GUI installation: contracts versus shipping behavior

The existing archive manifest at `packages/desktop/src/main/extension/manifest.ts` has:

```text
schema: opencode.gui-extension/1
id, name, version
renderer: path to a CommonJS renderer bundle
main?: path to a CommonJS main-process bundle
style?: stylesheet path
imports.renderer: declared host-supplied modules
imports.main?: declared main-process modules
```

Archive validation rejects absolute paths, path traversal, backslashes, control characters and other unsafe archive paths. The manager stores the manifest and file bytes transactionally in the Desktop database. It has enable, disable, reload, install, remove and source methods, and can preserve a last good main-process revision when a reload fails.

Those mechanisms do not establish a complete installation product:

1. `packages/desktop/src/main/ipc-handlers/extensions.ts` gates the management methods with `app.isPackaged`. Packaged applications reject them with `ExtensionError("unavailable")`.
2. `packages/app/src/runtime/extension/root.tsx` explicitly constructs definitions from built-ins only. It does not evaluate installed renderer archives.
3. Web has no Electron extension bridge. Main-process IPC contracts are inactive there.
4. `packages/core/src/plugin/module.ts` loads server/TUI/RPC plugins, not GUI archive definitions. There is no public agent-facing `plugin_manager.install_bundle` equivalent spanning those hosts.

Keep these guards. A first Creator implementation should generate inspectable source and previews, not enable unrestricted CommonJS code in a shipped application.

### Surfaces already available to shipping GUI extensions

The typed GUI SDK supports `Command`, `Panel`, `SettingsPage`, `MenuItem`, `Server`, `LinkHandler`, `TitlebarItem`, `Slot`, and `Style` registries. Session panel tabs support an owning screen, live session getters, restoration, close handlers and a mobile presentation. The current slot map is intentionally small:

- `window.bottom`;
- `session.header`;
- `session.panel.end`;
- `session.panel.sidebar`.

There is no arbitrary DOM inspection or mutation API analogous to a general runtime slot subtree. Extension host code must remain generic. Generated extensions should target documented registries, not inject DOM nodes into selectors or reach into another extension's state.

All contributions have scoped lifetimes. The GUI extension SDK already defines disposal, owner-scoped registration, abort signals, inactive contracts and server reconnection behavior. Any eventual dynamic renderer loader should reuse these contracts rather than launch a second independent UI framework inside the application.

## Interactive creations and 3D

### What can work now

Design creates a private work directory under `.red/code/design/<id>/work`, accepts HTML/React/Solid entries, publishes immutable revisions and serves a review frame. Its CSP and iframe sandbox allow the built JavaScript to run while withholding same-origin parent access and arbitrary network access. Generated experiences must keep state locally in memory and package their resources.

That makes the existing Design review suitable for a procedural Canvas/WebGL demo, a 3D scene inspector, a local diagram editor or a visual configuration tool. A minimal native WebGL scene needs no remote service or API key. It still needs a browser that supports WebGL and a useful fallback if a renderer cannot initialize.

Three.js is an optional local dependency, not a bundled Redcode capability. The inspected lockfile has no Three.js dependency. If a user's project already has it, Design's project dependency resolver can bundle a local import. If not, the agent must explain the missing dependency and obtain authorization through the existing tooling flow; it must not quietly use a CDN or install a service. Choosing a newer library version belongs to current package documentation and the actual selected project.

For an application that already depends on Three.js, a prototype can use ordinary local module imports and own its resources:

```js
import { WebGLRenderer, Scene, PerspectiveCamera, BoxGeometry, MeshBasicMaterial, Mesh } from "three"

const renderer = new WebGLRenderer({ antialias: true })
const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
const geometry = new BoxGeometry()
const material = new MeshBasicMaterial({ color: 0x6699ff, wireframe: true })
scene.add(new Mesh(geometry, material))
camera.position.z = 3
renderer.setSize(480, 480)
document.querySelector("main").append(renderer.domElement)
renderer.render(scene, camera)

// Call from the owning component's cleanup when the preview is replaced.
function dispose() {
  geometry.dispose()
  material.dispose()
  renderer.dispose()
  renderer.domElement.remove()
}
```

This snippet illustrates a local library integration. It has not been executed by the import-free plugin test and is not evidence that the current release bundles Three.js. An animation must additionally cancel its animation frame or animation loop when paused, hidden, replaced or disposed; a still preview does not need a perpetual render loop.

### Current limits to make explicit

`Design.ImportAsset` accepts PNG, JPEG, WebP, SVG and GIF. `design_asset` is not a glTF/GLB/OBJ/FBX importer. Exports currently cover HTML, PNG, PDF, GIF and review/audit formats; those are not 3D model exports.

Delivery can snapshot and download arbitrary local artifact files and retain their revisions. Its HTML preview is intentionally stricter than Design: scripts and external resources are disabled, and its iframe has `sandbox=""`. Publishing a `.glb` file does not automatically create a 3D viewer. A raw model can be delivered as a file while an interactive inspection experience remains in a Design preview.

Blender or another modeling process requires an explicitly available local program, MCP server or execution capability. The same applies to image generation and hosted image-to-3D/text-to-3D APIs. Existing provider keys must not be discovered or bound from ambient environment values. Creator's authoring workflow is provider independent; the user's selected language model remains responsible for the conversation.

### Executed visual proof

`packages/core/script/creator-preview-smoke.ts` exercises a procedural cube through the real Design snapshot, build, serialized review and preview runtimes. It uses the fixture at `test/fixture/creator-scene.html`, a server owned by the smoke and a separate headless Chromium instance. It does not restart an installed Redcode app or server.

Run from `packages/core`, with a locally installed Playwright Chromium browser:

```sh
bun run script/creator-preview-smoke.ts /absolute/path/to/proof-output
```

The output contains `creator-scene.png` and `report.json`. The recorded run used Chromium software WebGL (SwiftShader) and verified:

- visible 3D geometry: 113,031 non-background pixels before interaction;
- a rotation changes the geometry's projection;
- the material control changes rendered pixels from blue ceramic to warm clay;
- the production iframe keeps `allow-scripts allow-forms` but omits `allow-same-origin`, and accessing the parent document fails;
- there are no external resource requests and no page errors;
- releasing graphics deletes the renderer resources and loses the WebGL context;
- drawing happens on demand, with no permanent animation loop.

This focused smoke is separate from the large `design-review-smoke.ts` scenario driver so the optional software-GPU requirement and the 3D lifecycle assertions remain explicit. It reuses the production snapshot/build/review code instead of duplicating those implementations. Its route responses are controlled fixture metadata, not a second product backend.

The proof establishes that the existing Design runtime can display and interact with a local 3D creation. It does not establish a successful model conversation, persisted `DesignStore` admission, installation of a GUI plugin, or validity of a GLB/glTF export. Those contracts remain separate.

### Useful initial scenarios

| Request | Implement with existing mechanisms | Evidence before claiming success |
| --- | --- | --- |
| “Create a reusable diagnostic tool” | Local server plugin with a narrow input schema and no implicit credentials | Load plugin, inspect tool inventory, call it, unload it |
| “Create a skill for our workflow” | Project skill source or plugin-owned skill registration | Discover skill through the real skill inventory and read the resolved content |
| “Make an interactive 3D scene” | Design HTML/JS or local Three.js bundle | Publish revision, open review, confirm WebGL render or report initialization failure |
| “Let me change colors and camera” | Design parameters and in-frame controls | Exercise controls against the published revision and capture the result |
| “Give me the model file” | Explicit modeling/export tool and Delivery snapshot | Validate the produced file, publish it and provide its actual artifact revision |
| “Add this as a tab in Redcode” | Generate GUI SDK source and preview, then implementation handoff | State that production dynamic GUI installation is not yet shipped |
| “Use it in a TUI” | A real `./tui` plugin entry | Test terminal registration and teardown; do not claim GUI parity |

## Fifth-mode integration points

The first implementation needs no public protocol change if it uses existing agent, skill, Design and Delivery contracts:

1. Add a Creator built-in plugin beside Design and Question in `packages/core/src/plugin/`; register it after the existing four primary agents in `internal.ts`.
2. Register a bundled `redcode-creator` authoring skill with `SkillPlugin`. Give it current package entry points, manifests, permission rules, verification steps and explicit unsupported surfaces.
3. Keep Creator's identity and workflows distinct from Design. Creator builds reusable capabilities and artifacts; Design owns visual review machinery. Calling `design_document` does not mean switching the agent or asserting that a GUI extension is installed.
4. Update built-in identity/color order in `packages/tui/src/context/local.tsx` and `packages/app/src/providers/models/agent.ts` to `build`, `plan`, `design`, `question`, `creator`. The server agent inventory drives actual choices.
5. Keep the existing Build-like authoring permissions deliberate. A custom prompt is not a sandbox. For a later restricted Creator workspace, add real permission rules and include Creator in `Permission.forAgent`'s restricted-mode policy so old session Build grants cannot widen it.
6. Do not add Creator to task-phase schemas unless a distinct persisted task phase is required. `session-todo.ts` currently classifies non-Design/non-Plan agents as Build. Adding an enum solely to match an agent name would unnecessarily change the public contract.
7. Document the boundary between a generated package, an active server plugin, a Design review and a shipped application feature. Add a Changeset for the user-visible mode.

The public agent ID is a string brand, so adding a built-in does not require a new agent enum or migration. Introducing a future Creator document/store/installation protocol would require Schema/Protocol ownership and regenerated clients; merely adding the mode and skill does not.

## Further native extension work

The isolated panel lifecycle is implemented. Broader native SDK contributions still need:

- Bundle contracts for additional UI surfaces and declared host capabilities, distinct from a privileged Electron main bundle.
- A review/install boundary that targets a particular server, client or session. A remote server cannot silently install code on every connected desktop.
- A generic loader shared by Web and Desktop, with lifetime and failure handling through the existing GUI SDK.
- An isolated preview that can exercise declared UI contributions without inheriting application credentials or unrestricted DOM access.
- An observable inventory for the agent: installed revision, enabled state, load error, available contributions and verification receipts.
- Session/tool result delivery for agent requests that need a live client; clients may disconnect while the server continues.
- Restore, rollback, update and removal rules that dispose contributions and resources without retaining old renderers, subscriptions or GPU buffers.

These should be implemented as real contracts, not as text assertions in the Creator prompt. Reuse the existing dependency graph and scoped extension host. Do not weaken the packaged-app guard as a shortcut.

## Validation ownership

- `packages/core/test/plugin.test.ts`: real import-free package loading, invocation and tool withdrawal. Added Creator package case passes independently.
- `packages/core/test/agent.test.ts`: fifth primary agent inventory, prompt and declared permissions.
- `packages/core/test/skill.test.ts` and existing skill plugin tests: embedded authoring skill registration/discovery where applicable.
- `packages/core/test/design-tools.test.ts`, `design-store.test.ts`, `design-build-home.test.ts`: reuse the actual work/build/revision pipeline instead of mocking a Creator renderer.
- `packages/core/test/session-artifacts.test.ts`: safe file ownership, snapshot revisions and conflict checks.
- `packages/app/component-tests/extension-host.spec.ts` and `extension-graph.spec.ts`: future generic host lifetime and dependency contracts.
- `packages/desktop/src/main/extension/manager.test.ts`, archive/lifecycle tests and real IPC contract tests: future installation and rollback boundaries.
- The existing app e2e keeper suites own end-user mode selection and review surfaces. Add a case there when behavior changes; do not add duplicate source-text tests.

For the initial implementation, run the owning Core tests through `bun run test` from `packages/core` and the root `bun run check`. An arbitrary renderer screenshot alone cannot prove that a plugin tool was installed or that a 3D model export is valid.

## Evidence and implementation status

This mapping was produced by static inspection of the paths cited above. The import-free plugin example was additionally exercised through the real runtime in the focused keeper test (one test, four assertions); the complete owning plugin keeper passed 20 tests and 64 assertions. The visual smoke above also passed, and its screenshot was inspected. No installed Desktop or server process was restarted. No plugin was installed into personal configuration, no external provider was provisioned, and no GUI archive guard was removed.

The implementation includes the Creator mode, bundled authoring skill, stable client identity
colours, the Creator review link in the TUI and the isolated project-component lifecycle described
above. The public agent endpoint was checked for all five primary modes, and the TUI keeper covers
resumed Design and Creator previews without launching another browser. Native privileged plugins,
arbitrary global slots and the seven full DeepSeek demo applications remain outside this scope.

### Dynamic-component validation

- Core lifecycle and frame checks: three tests, 26 assertions, including portable snapshots after
  deleting both source conversation and revision, failed-update preservation, version conflicts,
  directory/workspace isolation and runtime bootstrap placement under the existing CSP.
- Permission checks cover Question with a permissive session grant and explicit approval for
  component mutations. The authenticated API test also covers structured errors and input validation.
- Three production UI keepers cover installation, pinned revisions, conflicts, update, disable,
  re-enable, removal, scoped remote project settings, asynchronous Desktop storage, exception and
  Promise diagnostics, forged-message rejection and iframe disposal. Remote servers are simulated
  with the real contracts; Desktop uses the fixture bridge rather than an installed Electron binary.
- Search tests: 13 passed. Existing extension-lifecycle tests: 29 passed. Code-generator tests: 91
  passed. The new metadata contract, current event manifest and V1 isolation checks passed.
- The production cold-session benchmark used three samples before and three after: median stable
  render 832.9 ms before and 840.1 ms after (+0.9%). This short run shows no material regression;
  it is neither a long-term memory soak nor evidence of a speed improvement.
- Root lint and all 27 package type-check tasks passed. Test-only Vite fixtures were stopped.

The wider Schema hygiene suite also exposed an existing failing guard: `model-suggestion.ts`
contains `Schema.mutable` and `connection-check.ts` contains `Schema.mutableKey` in baseline
commit `1c5579fb42`. These predate Creator components and were not rewritten or exempted here.
The new Creator contracts use readonly public shapes. A separate pre-existing V1 test used a
URL pathname as a filesystem path; it now uses `fileURLToPath` and passes on Windows.
