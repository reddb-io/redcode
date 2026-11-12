# Cube studio · Creator example

A real WebGL cube installed as a project-scoped Creator component. Uses the vendored
`@reddb-io/design-system` React **Button, Badge, Slider and Switch**, its application theme,
compact density, colors, typography and embedded fonts. It needs no API key or remote assets.

Drag the cube or use the arrow keys to rotate. Change the material, size, zoom and wireframe.
Mouse-wheel zoom updates the slider too. Animation is opt-in, capped at 30 fps and suspended
while hidden. A paused scene renders only when something changes. Disposal releases GPU
resources, observers and event handlers.

## Build and install

From `packages/app`:

```powershell
bun run examples/creator-cube/build.ts
```

The output `component.html` bundles the actual DS components and styles. To install in an
existing project, ask Creator to create an HTML Design document, copy this HTML into the
returned work entry, publish with `design_preview`, and install with `creator_component`.
Alternatively open **Creator components → Install component**, select the published artifact
and confirm. Changes to the source require publishing and updating the installed revision.
The build commands here are developer/manual steps. In its specialized mode, Creator uses
the artifact builder and returned work root; executing repository scripts belongs to Build.

Example request:

> Use the already-built Cube studio component.html, create and publish a Design document in
> this project, define its artifact delivery contract, verify the controls, then install it as
> “Cube studio” in Creator components. Reuse an existing source document/installation if present.

## Reproduce the local demonstration

After building the app (`bun run build` from `packages/app`), run from `packages/core`:

```powershell
bun run script/creator-cube-demo.ts
```

Open <http://127.0.0.1:3199/demo/setup>. Use **Open Creator components → Install component →
Published artifact → Cube studio → Install component**. This serves the built Redcode app and
the production server handlers with a dedicated SQLite database and project under the temp
directory. No component API responses are mocked; no model execution or personal provider
configuration is needed. It does not connect to the user's usual Redcode server. The server
binds only to loopback. Stop this demonstration process after use; its database/files remain.

The optional first argument changes the output directory; the second changes the port.
The component's source lives in the demonstration project's `.red/code/design` directory.
Running the demo after a rebuild publishes a new source revision; update the installed
component through its toolbar. Existing installations survive a demo-server restart.

`verify.ts <CDP URL> [output directory]` attaches to this demo's existing automation browser
and checks rendered WebGL pixels, material/size/wireframe, keyboard/drag, wheel-to-slider
synchronization, animation/pause, idle rendering and iframe isolation. It writes screenshots
and a verification report. Install/update/restart steps are performed through the real demo
before running this check; they are listed as observed evidence rather than simulated here.

## Creator and Designer

Designer focuses on prototyping an interface, iterating with review feedback and handing
approved decisions to Plan/Build. Creator focuses on delivering interactive artifacts and
authoring reusable components, tools, skills and plugin source. Both reuse the Design revision
and preview infrastructure. 3D is not exclusive to Creator. The useful extra in this example
is a versioned, installed panel available across conversations in its execution project.

Installed components are isolated renderer panels: no parent DOM, host APIs or server
credentials. This example is procedural WebGL, not generated 3D assets, Blender or a GLB exporter.
