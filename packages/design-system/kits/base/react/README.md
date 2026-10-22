# Base Kit: React flavor

Native React 19 implementations of all 101 Base contracts, within the same
219-component catalogue as the Svelte flavor. Sync selects the flavor behind
canonical Kit imports; the full parity gate has no migration allowances.

| Area | Components |
| --- | --- |
| Actions and feedback | Button, Badge, LoadingIndicator, Swap |
| Native forms | Input, Textarea, Label, Field, FileInput, Rating, ToggleButton, Checkbox, Switch, RadioGroup, Select, NumberField, Slider, OneTimeCodeInput, InlineEdit |
| Type and layout | Heading, Text, Stack, Divider, Container, AspectRatio, ContentMask, Eyebrow, Prose, SectionHeading |
| Collections and readings | List, GridList, DescriptionList, Statistic, Kbd, CodeBlock |
| Native groups and navigation | Form, Fieldset, ControlGroup, SkipLink, ToggleGroup, AppearanceSwitch |
| Media and surfaces | Icon, Image, Logo, Card, MediaObject, ListContainer, Avatar |
| Feedback and navigation | Link, Alert, Notification, EmptyState, Breadcrumbs |
| Native data and wayfinding | Table, ScrollArea, Timeline, Steps, Pagination, Countdown |
| Presentations | SlideFrame, TitleSlide, SectionSlide, TwoColumnSlide, FigureSlide, QuoteSlide, BulletsSlide, Deck |
| Decorative previews | BrowserMockup, WindowMockup, PhoneMockup |
| Native motion | Reveal |
| Managed collections | Accordion, Disclosure, Tabs, Carousel |
| Searchable selection | Combobox, SearchSelect |
| Calendar and segmented fields | DateField, DateRangeField, TimeField, TimeRangeField, Calendar, RangeCalendar, DatePicker, DateRangePicker |
| Managed overlays | Dialog, Drawer, AlertDialog, DropdownMenu, Popover, Tooltip, LinkPreview |
| Coordinated navigation | Navbar, NavigationMenu, NavigationScope |
| Status and progress | Indicator, StatusIndicator, Skeleton, Meter, Progress, RadialProgress |

The canonical `metadata/components.json` records availability and native APIs
for both frameworks. Its `metadata/react-components.json` projection lists React APIs,
custom props, defaults, native attributes and Primitive/Composite classification.
Run `pnpm --filter @reddb-io/catalogue generate` after API edits.

## Sync

Pin **v2026.10.22 or newer**. React is **not included in v2026.10.21**.
Add `"framework": "react"` to the application's existing Sync manifest, declare
`"kits": ["base"]`, and choose styles independently, for example
`"styles": ["application"]`. Omission preserves Svelte. Unsupported React Kits
fail before replacing existing files.

Source TSX is default. Optional compiled distribution uses the same contract:

```json
{ "distribution": { "format": "compiled", "minify": true, "sourcemaps": false } }
```

Sync vendors only React and the shared recipes its components import. The rendering peers are
React and React DOM; the application installs the declared versions. Tailwind 4 still
runs in the application. Import the vendored style entry from its Tailwind CSS
and register the vendored directory as a Tailwind source. Compiled delivery
registers its generated candidate list so minification cannot hide class names.

## Compose

```tsx
"use client";

import { useState } from "react";
import { Button, Field, Input, Stack } from "@reddb-io/design-system/base";
// Individual imports also work:
// import { Button } from "@reddb-io/design-system/base/Button";

export function OrganizationForm() {
  const [name, setName] = useState("");
  return (
    <form>
      <Stack>
        <Field label="Organization" help="Used for billing" required>
          {control => <Input {...control} name="organization" value={name} onValueChange={setName} />}
        </Field>
        <Button type="submit" variant="primary">Save organization</Button>
      </Stack>
    </form>
  );
}
```

Props use `className`, `htmlFor`, native React events and ReactNode children.
`onChange` receives a React event; `onValueChange` receives a string for text
controls, a number for numeric inputs, or null for an empty numeric input. Use `value`
with a change handler for controlled fields, or `defaultValue` for uncontrolled
fields, native serialization and reset. Field uses hydration-stable IDs and
passes label/help/error associations to its control. Fieldset passes group help/error
associations while native fieldset/legend own disabled behavior and naming.

Components inherit Theme, Color Scheme and Density. They share the canonical
hover, pressed, focus, disabled, coarse-pointer and reduced-motion recipes.
The barrel does not force a client boundary; interactive modules carry their own.

Menus, overlays and navigation composites are native React implementations.
The App, Data and Marketing Kits also have complete native implementations;
React delivery excludes Svelte rendering engines.

## Shared contracts and coverage gates

Semantic logic and types live in the Kit's framework-independent `src/core/`.
Both adapters import the same Field association and Input value normalization.
Shared scenario suites run against real Svelte and React components; the catalogue
follows shared imported interfaces and their JSDoc.

`metadata/framework-parity.json` separates export coverage, API differences and
scenario declarations. Native type translations are explicit in
`packages/catalogue/framework-contracts.json`. Test declarations are navigation to
evidence; passing suites and browser checks provide actual execution evidence.

- `pnpm --filter @reddb-io/catalogue parity:check`: full structural/contract coverage;
  requires all 219 native implementations and aligned public contracts.
- `pnpm --filter @reddb-io/catalogue parity:ratchet`: historical migration comparison;
  the current baseline has zero gaps, and CI uses the full `parity:check` gate.
- `pnpm --filter @reddb-io/catalogue parity:baseline`: explicitly records the
  structural baseline; inspect its diff. It cannot bypass the full coverage gate.

The [React workspace overview](../../../apps/showcase/src/routes/examples/react-base)
combines the expanded Base subset with editable alert settings, request delivery,
status markers, accessible readings and native collections. DescriptionList's
portable appearance is separate from Svelte-native content types; React delivery
contains no Svelte declaration dependency. Progress, Meter and RadialProgress
share range normalization with Svelte, including non-finite and collapsed ranges.

## Media and surfaces

`Icon` accepts a glyph imported selectively from `lucide-react`, an optional
peer. The built-in `icon="menu"` requires no icon runtime. Both wrappers use
the same Density sizes, semantic ink roles and fixed stroke. Brand Marks stay
in Logo, never in Icon.

`Image` requires meaningful alt text (or `alt="" decorative`) and a reserved
box from intrinsic dimensions or a ratio. Responsive `srcset`, ordered picture
sources and fetch priority keep the canonical contract. `Card` composes it,
with native ReactNode header, media and footer slots, horizontal/background
media, role surfaces and background work that preserves the content.

`Logo` shares the exact pinned Marks, selection, mandatory clearspace and
minimum size with Svelte. Explicit `on` describes the local surface; otherwise
it follows document Color Scheme changes. SSR/hydration starts deterministically
on light before reconciling with the document. Unsupported Marks throw.
Source delivery uses the application's normal SVG asset handling. Compiled
React delivery includes opaque data-URL modules so Node SSR works without an
SVG loader; decoding a URL yields the unchanged Brand bytes, also shipped as
original SVG files. Unused assets disappear from application output through
per-component imports and tree shaking.

Native `Notification` owns explicit dismissal without inventing placement or
auto-dismiss timers. Alert's urgency is shared (`danger` announces an alert;
other tones announce status). `Breadcrumbs` uses the same typed items and safe
JSON-LD serializer as Svelte, including opt-in absolute URL resolution.
Decorative mockup chrome stays hidden from assistive technology while the
caller-owned viewport content retains its semantics. React APIs use canonical
`tone`; deprecated Svelte `feedback` aliases remain a Svelte migration seam.

`Table` shares portable column/row/cell context types, native caption and header
relationships, custom React cell renderers, a named keyboard-scrollable region
and hydration-stable caption ids. ScrollArea uses native overflow. Timeline,
Steps and Pagination keep application-owned destinations and current-state data;
Countdown formats caller-owned remaining seconds without creating a timer.
The breadcrumb appearance is shared across frameworks: quiet caption-size links,
regular weight, lighter decorative separators and Density-owned spacing.

The [native controls review](../../../apps/showcase/src/routes/examples/react-controls)
exercises Rating, ToggleButton and FileInput alongside their Svelte counterparts.
React `pressed`/`value` are controlled; `defaultPressed`/`defaultValue` initialize
uncontrolled state. Svelte retains writable `bind:pressed`/`bind:value` and supports
the same initial defaults. Rating resets to its initial default without emitting
a user-change callback. A controlled React rating keeps its supplied value until
the application updates it (including from a form's `onReset`). ToggleButton is
a non-submitting action and is not reset by forms.

FileInput accepts a real `FileList` through `files` and clears with `null`; strings
cannot populate a native file input. `onFilesChange` reports user selection while
`onChange` retains its native React event. Omit `files` for browser-owned selection.
Native reset clears uncontrolled file feedback. For a controlled React selection,
the application clears its state from `onReset`; Svelte `bind:files` follows reset.

The [choices and preferences review](../../../apps/showcase/src/routes/examples/react-choices)
composes Checkbox, Switch, rich RadioGroup cards and native single/multiple Selects.
All retain native keyboard, validation, disabled and form semantics. React checkbox
and switch state remains aligned with native form reset so the next change still
fires. Svelte checked bindings follow reset without emitting a user-change callback.
RadioGroup exposes `defaultValue` for uncontrolled initialization; `value` stays
controlled in React and writable through Svelte binding.

Select's flat `options` can be followed by native option/optgroup children. Multiple
selects use native row height and serialize every selected option. `onValueChange`
keeps the canonical first selected string; use `onChange`'s `selectedOptions` or
FormData.getAll for every selected value. `defaultValue` initializes uncontrolled
single/multiple choices in both frameworks. Native refs and required/help/error
associations remain available through the same Field and Fieldset contracts.

## Presentations

The [collection review](../../../apps/showcase/src/routes/examples/react-slides)
composes all eight presentation contracts with a matching Svelte deck. SlideFrame
keeps the canonical 16:9 CSS-scaled canvas and accessible slide name/number.
Layout typography and spacing share the Svelte recipes; Deck gaps follow Density.
Columns and figures accept native React content. Base imports no chart engine.
All eight modules support native refs and SSR without a client directive.
Deck stacks slides in reading order; presentation navigation and speaker notes
remain outside this contract. The example's edition control is local composition.

## Numeric and code entry

The [native entry review](../../../apps/showcase/src/routes/examples/react-numeric-entry)
composes NumberField, Slider and OneTimeCodeInput with their Svelte counterparts.
React values remain caller-owned; defaultValue initializes native uncontrolled
controls. NumberField keeps decimal arithmetic and constraints in the browser,
including its initial step base. It reports native form reset through onValueChange
as the canonical NumberField contract requires. Slider and OTP reset without a
user-change callback. Canceled resets preserve current values in every control.

Slider's shared range sanitization keeps the SSR readout and the native thumb in
agreement. OTP renders every segment during SSR, preserves empty positions during
entry, supports formatted paste and keyboard navigation, and submits one complete
code. Native pattern and required validation remain authoritative. Its ref exposes
the fieldset; NumberField and Slider expose their native input.

## Code and state actions

The [code actions review](../../../apps/showcase/src/routes/examples/component-flavors-code)
shows both implementation flavors of the same request panel. Swap composes
ToggleButton and keeps one stable name across its faces; native click precedes
onSwappedChange. defaultSwapped initializes an uncontrolled face; swapped is
caller-owned in React and writable through Svelte binding.

CodeBlock shares exact-source tokenization, semantic highlight roles, native
clipboard handling and overflow measurement. SSR contains the source and token
spans without adding a scroll-region tab stop. After hydration only an overflowing
block becomes a named, focusable region. Source changes reset copy feedback;
failed clipboard access offers a retry, and stale asynchronous completions cannot
mark new source as copied. Neither component adds a highlighter or behavior engine.

## Editing and entry motion

The [editing and motion review](../../../apps/showcase/src/routes/examples/component-flavors-edit-motion)
uses both flavors for project settings and a scrollable review checklist.
InlineEdit shares a draft transaction: validation and persistence run before the
commit callback, duplicate saves are blocked, and a newer value, closed session
or unmount invalidates late completions. React value/editing stay caller-owned;
defaultEditing opens an uncontrolled initial draft. Svelte retains writable bindings.
Initially open editors include their committed text in SSR. Escape and Cancel
discard drafts and return focus; composition Enter stays inside the input.

Reveal shares native ViewTimeline/WAAPI behavior and an IntersectionObserver
transition fallback. A millisecond delay selects the timed transition path.
Server-rendered content is visible before hydration and without JavaScript.
Live reduced-motion preferences settle content, and cleanup cancels animations,
observers and media listeners. Directional movement uses the Density inset role.
No motion or managed-behavior runtime is added to either flavor.


## Identity and preferences

The [team inbox reference](../../../apps/showcase/src/routes/examples/component-flavors-identity)
composes named Avatars, status markers and a ToggleGroup-driven conversation view.
Avatar requires a text fallback or a native Icon glyph, preserves its accessible
name when an image fails, and attempts a replacement source without remounting the
identity. The optional icon peer remains unnecessary for text-only avatars.

ToggleGroup shares enabled-value resolution and roving keyboard selection,
including RTL, Home/End, disabled options and wrapping. It composes Fieldset and
ToggleButton, forwards help/error associations, submits one hidden value, and
supports external form ownership and canceled resets. defaultValue initializes
uncontrolled selection; React value remains caller-owned through reset.

AppearanceSwitch composes Field and the native Select. It changes only its named
axis on the supplied root (the document root when omitted). Uncontrolled use
restores an enabled persisted option; controlled React value takes precedence and
applies after onValueChange is acknowledged. Svelte retains writable bindings.
Prop or scope changes apply without a user callback. Storage denial and quota
errors leave the choice usable in memory. A native form reset restores the initial
uncontrolled option without emitting a user change. The reference scopes controls
to its list and does not change the surrounding showcase appearance.

### Request review and scheduling

All Base components now have native implementations, including named native
Dialog/Drawer/AlertDialog overlays, anchored menus and previews, searchable
single/multiple selection, segmented date/time fields, calendars and date
pickers, responsive Navbar, NavigationMenu and Carousel. A
[request review](../../../apps/showcase/src/routes/examples/component-flavors-request-review)
composes them with keyboard navigation, nested overlays, native forms and SSR.

Managed React behavior uses individual Base UI subpaths. Calendar date values
remain portable `@internationalized/date` values. Portal content retains its
source's Theme, Color Scheme, Density and native dialog boundary. A pending
confirmation belongs to one overlay session. Uncontrolled form fields reset
silently; controlled React values remain caller-owned.

The complete inventory has 101 Base, 38 App, 34 Data and 46 Marketing components
in both flavors. The [workspace](../../../apps/showcase/src/routes/examples/component-flavors-workspace),
[monitoring](../../../apps/showcase/src/routes/examples/component-flavors-data) and
[product story](../../../apps/showcase/src/routes/examples/component-flavors-marketing)
references complement this Base guide with matching native compositions.
Implementation/API coverage and executed runtime evidence remain separate fields
in the canonical inventory.
