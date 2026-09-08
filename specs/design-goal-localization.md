# Design and Goal localization coverage

The 95 messages introduced by the App Design studio and extended Goal controls ship with English source copy and a complete Brazilian Portuguese dictionary. Other selected App locales deliberately use English for these messages. This release does not claim that the new domains have been translated into all 61 non-English locales. Existing translations outside these domains remain in place.

`packages/app/src/i18n/design-goal.ts` owns the exact key set, the supported locales and `designGoalCoverage(locale)`. It distinguishes translated keys from English fallback keys rather than treating dictionary completeness as translation completeness. Each locale includes this domain dictionary before its own entries, so future reviewed translations can override it.

The shared Language API resolves count messages with the language of their copy. English fallback uses English plural rules even when the selected locale treats zero or 101 as singular. Brazilian Portuguese uses the project's existing CLDR-backed locale rules. All locale-specific cardinal variants remain available, with the same `{{count}}`, `{{used}}` and `{{max}}` placeholders as the English source.

The existing parity suite remains unchanged. Additional tests verify the complete Portuguese key set, exact English fallback, explicit coverage reporting, placeholders and source-language plural selection. To add another supported locale, supply a complete reviewed dictionary, update the declared locale coverage and extend these checks; adding English entries alone does not qualify as a translation.

Brazilian Portuguese terminology and source references are documented in [the translation review](design-goal-localization-br.md).

The Design studio remains lazily loaded. Its Solid owner tracks translated copy before asynchronous module resolution and uses the latest dictionary when mounting. Later dictionary resolution or locale changes update the mounted studio through the compatible `mountReview` disposer’s `updateCopy` method. Labels, accessible names, status messages and review evidence update in place; intake fields, preview and whiteboard frames, and ongoing requests retain their identity. Changing the session or disposing the owner still cleans up the previous studio, including request cancellation and its refresh timer. The standalone review host can still serialize the self-contained `mountReview` function.

Browser-condition tests exercise the real review implementation with delayed module resolution, an intake draft, both frame identities, and an ongoing request. They also verify that disposing the owner before the import resolves never mounts the studio.
