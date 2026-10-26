# Data implementation flavor

The native React adapters implement the same 34 Data component contracts.
Select `"framework": "react"` in the Sync manifest and keep canonical imports:

```tsx
import TimeSeries from "@reddb-io/design-system/data/TimeSeries";
import Table from "@reddb-io/design-system/data/Table";
```

There is no Data barrel in the delivered package. Public component subpaths are
explicit; internal layouts and engines are not package exports. React draws
SVG/HTML over shared models and geometry. Optional engines load only at their
component boundary. TerminalSession receives the application's engine factory.

`/data/static` exports `renderStaticVisualization(Component, props)` for trusted
build/server rendering without hydration. It accepts a separately imported
component and never registers every graphical family.

Contract and consumer scenarios cover charts, diagrams, trace intervals,
readings, tables, editors, collections, terminals and maps. Native JSX content
replaces zero-argument snippets; render functions retain the same data context.
Controlled React values report changes to their caller. Svelte retains writable
bindings. Source and compiled delivery share the same selection and import paths.
