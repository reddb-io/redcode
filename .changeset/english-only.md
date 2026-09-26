---
"@reddb-io/redcode": patch
---

Remove the i18n abstraction entirely; the app is English-only from now on. All runtime translations, locale detection, the language picker and RTL layout toggles are gone: `language.t()` / `plural()` call sites are inline English strings, the locale dictionaries (app, ui, desktop renderer), the language context, the desktop native translation bundles and the `@solid-primitives/i18n` dependency were removed. The public docs-site/share viewer i18n (astro `content/i18n`) is unchanged.