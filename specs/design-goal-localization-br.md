# Brazilian Portuguese: new Design and Goal messages

Reviewed on 2026-09-08. `packages/app/src/i18n/design-goal-br.ts` translates the
76 new Design studio messages and 19 new Goal messages. It also provides the two
Brazilian Portuguese `.many` variants: 97 dictionary entries in total. Existing
Goal dialog copy outside these 95 new source keys is outside this translation.
English source copy and placeholders are unchanged.

## Sources consulted

- [Unicode CLDR cardinal rules](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/plurals.json):
  Portuguese uses `one`, `many` and `other`. Integer 0 and 1 use `one`; ordinary
  integers from 2 use `other`; whole multiples of one million use `many`.
- [Microsoft Portuguese (Brazil) Localization Style Guide](https://aka.ms/portuguese-brazil-styleguide),
  linked by the [official guide index](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides):
  consistent UI terminology, complete contextual phrases and natural error
  messages. The guide explicitly supports “Não foi possível” for a failed past
  action, used in the Goal update error.
- [Microsoft VS Code Brazilian Portuguese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-pt-BR/translations/main.i18n.json):
  developer terminology including “provedor”, “agente”, “tokens”, “Referências”,
  “Revisão”, “Visualização”, “Bloqueado”, “Exportar” and “Baixar”.
- Mozilla's independent Brazilian Portuguese
  [downloads corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/pt-BR/browser/browser/downloads.ftl)
  and [Inspector corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/pt-BR/devtools/client/inspector.properties):
  action labels such as “Cancelar”, “Remover arquivo” and “Tentar baixar
  novamente”, plus element/selection terminology for the annotated preview.
- The [Academia Brasileira de Letras vocabulary portal](https://www.academia.org.br/nossa-lingua/busca-no-vocabulario)
  was consulted as the national authority. Its lexical query endpoint returned
  HTTP 403, so individual entries could not be verified there. The accessible
  Priberam entries for [design](https://dicionario.priberam.org/design) and
  [evidência](https://dicionario.priberam.org/evid%C3%AAncia) were used as a lexical
  cross-check; Brazilian developer corpora determine the UI phrasing.

## Terminology and retained terms

| Source concept          | Brazilian Portuguese choice                        |
| ----------------------- | -------------------------------------------------- |
| Goal                    | objetivo                                           |
| Provider turn           | turno do provedor                                  |
| Evidence file           | arquivo de evidência                               |
| Review / revision       | revisão, with surrounding action/context preserved |
| Preview                 | visualização                                       |
| Assets                  | recursos visuais                                   |
| Feedback / review notes | comentários / anotações da revisão                 |
| Whiteboard              | quadro branco                                      |
| CSS custom property     | propriedade CSS personalizada                      |

“Turno do provedor” names one provider interaction in this product; it should
remain distinct from tokens or the complete Goal. “Revisão” refers both to a
review activity and an immutable published revision, as in the English source;
the complete surrounding phrase identifies which one is meant.

`Design` and `Plan` remain mode names. Lowercase `design`, `layout` and `tokens`
are established developer borrowings. HTML, SVG, GIF, CSS and `px` are retained
acronyms/unit identifiers. The only complete translated value identical to its
English source is the `Design` title; other retained terms occur inside
translated Portuguese phrases. No unexplained complete English values remain
among these new messages.

The 95 source keys, all placeholders (`used`, `max`, `count`), and both `.many`
variants were checked against the English dictionary and CLDR rules. Provider
turn terminology and the shared review/revision term are the main points for a
future independent native-language editorial review.
