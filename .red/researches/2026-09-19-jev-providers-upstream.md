# Jev: OpenCode upstream, models.dev e providers

Date: 2026-09-19 (America/Sao_Paulo)
Query: Verificar como o OpenCode original integrou Jev com providers e consultar anomalyco/models.dev.
Scope: Código público das branches dev, catálogos públicos ao vivo, documentação oficial e comparação com o setup local. Nenhuma chamada de inferência paga ou autenticada foi feita.

## Executive Summary

O suporte explícito encontrado no OpenCode é no gateway **Zen**, com formato `systemone`, endpoint próprio e adaptador para o contrato TypeSafe. Uma verificação posterior confirmou também a oferta pública do OpenRouter: `typesafe/jev-1.13` é servido pela Decisions API em `POST https://openrouter.ai/api/alpha/decisions`. Ele não aparece no catálogo convencional de chat `/api/v1/models`, que foi a fonte da conclusão incompleta na primeira versão desta pesquisa.

O catálogo models.dev lista Jev no OpenCode Zen, Cloudflare AI Gateway, Vercel e Vivgrid. `models/typesafe/jev-latest.toml` descreve o modelo base, não uma conexão direta de provider TypeSafe. O catálogo público consultado não contém um provider direto `typesafe`.

Nossa implementação local aceita TypeSafe direta e RedRouter no contrato nativo. Precisa incorporar descoberta pelo catálogo existente, identidades de provider/modelo, reutilização explícita de conexões e adaptadores por contrato. Cloudflare não funciona apenas trocando a base URL.

## Official Sources / Hotlinks

- [OpenCode: rota Zen System One](https://github.com/anomalyco/opencode/blob/83abc64a5c4e0e0a5157f2c4435d34131009a404/packages/console/app/src/routes/zen/v1/systemone.ts) — rota POST, formato e ausência de streaming.
- [OpenCode: adaptador System One](https://github.com/anomalyco/opencode/blob/83abc64a5c4e0e0a5157f2c4435d34131009a404/packages/console/app/src/routes/zen/util/provider/systemone.ts) — endpoint, autenticação, corpo e uso.
- [OpenCode: teste do adaptador](https://github.com/anomalyco/opencode/blob/83abc64a5c4e0e0a5157f2c4435d34131009a404/packages/console/app/test/providerUsage.test.ts) — TypeSafe como upstream do formato.
- [OpenCode: documentação Zen](https://github.com/anomalyco/opencode/blob/83abc64a5c4e0e0a5157f2c4435d34131009a404/packages/web/src/content/docs/zen.mdx) — Jev 1.13, IDs e endpoint.
- [OpenCode: plugin models.dev](https://github.com/anomalyco/opencode/blob/83abc64a5c4e0e0a5157f2c4435d34131009a404/packages/core/src/plugin/models-dev.ts) — integrações e catálogo derivados de metadados.
- [OpenRouter: Jev 1.13](https://openrouter.ai/typesafe/jev-1.13) — oferta pública do modelo e acesso pela Decisions API.
- [models.dev: modelo base Jev](https://github.com/anomalyco/models.dev/blob/f85553799b09968cd6e0d4b94a65e771d8eaf397/models/typesafe/jev-latest.toml) — capacidades e limites.
- [models.dev: Jev no Zen](https://github.com/anomalyco/models.dev/blob/f85553799b09968cd6e0d4b94a65e771d8eaf397/providers/opencode/models/jev-1.13.toml).
- [models.dev: Jev no Cloudflare](https://github.com/anomalyco/models.dev/blob/f85553799b09968cd6e0d4b94a65e771d8eaf397/providers/cloudflare-ai-gateway/models/typesafe/jev.toml).
- [models.dev: curadoria Cloudflare](https://github.com/anomalyco/models.dev/blob/f85553799b09968cd6e0d4b94a65e771d8eaf397/providers/cloudflare-ai-gateway/curation.toml) — explicita avaliação via /ai/run.
- [models.dev: Jev no Vercel](https://github.com/anomalyco/models.dev/blob/f85553799b09968cd6e0d4b94a65e771d8eaf397/providers/vercel/models/typesafe-ai/jev.toml).
- [models.dev: Jev no Vivgrid](https://github.com/anomalyco/models.dev/blob/f85553799b09968cd6e0d4b94a65e771d8eaf397/providers/vivgrid/models/jev.toml).
- [Catálogo publicado models.dev](https://models.dev/api.json), [catálogo OpenRouter](https://openrouter.ai/api/v1/models), [catálogo Zen](https://opencode.ai/zen/v1/models) — consultados sem credenciais.
- [TypeSafe: modelos](https://docs.typesafe.ai/models.md) — IDs versionados e aliases.
- [Cloudflare: Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/) — exemplos reais do contrato por binding e REST.
- [Cloudflare: REST](https://developers.cloudflare.com/ai-gateway/usage/rest-api/) — endpoint, envelope e autenticação.

## Key Findings

| Provider | ID verificado | Evidência de contrato |
| --- | --- | --- |
| TypeSafe direta | `jev-1.13.0`, alias `jev-latest` | API nativa `/v1/systemone` documentada |
| OpenCode Zen | `jev-1.13`, `jev-1.13-free` | catálogo ao vivo e `/zen/v1/systemone` implementado |
| Cloudflare AI Gateway | `typesafe/jev` | catálogo e documentação `/ai/run` |
| Vercel | `typesafe-ai/jev` | catálogo; transporte específico não investigado nesta consulta |
| Vivgrid | `jev` | catálogo; transporte específico não investigado nesta consulta |
| OpenRouter | `typesafe/jev-1.13` | Decisions API em `/api/alpha/decisions`; não é um modelo de chat |

No upstream, o adaptador Zen preserva o corpo recebido, adiciona `Authorization: Bearer`, adiciona `x-session-affinity`, utiliza `/systemone`, não implementa decoder de streaming e normaliza `usage.input_tokens`/`output_tokens` para a contabilidade do gateway. O handler seleciona providers compatíveis com `format: systemone`.

Não encontrei código específico de execução Jev ou escolha de System One nos diretórios de runtime Core/CLI/LLM do upstream. A evidência concreta de execução é o gateway Console/Zen; não devemos confundir isso com um agente já usando Jev para decidir compactação ou completude.

O modelo base em models.dev declara `tool_call=false`, `reasoning=false`, `temperature=false`, `structured_output=true`, contexto 64000 e saída 0. Cloudflare e Vercel sobrescrevem contexto para 32000. Esses flags descrevem capacidades, mas não constituem por si só um identificador universal do protocolo System One.

## API / CLI / Config Details

TypeSafe e Zen:

```json
{"model":"<ID do provider>","state":"...","questions":{"check":{"type":"noul","instructions":"..."}}}
```

Cloudflare:

```text
POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run
Authorization: Bearer <CLOUDFLARE_API_TOKEN>
```

```json
{"model":"typesafe/jev","input":{"state":"...","questions":{"check":{"type":"noul","instructions":"..."}}}}
```

A documentação Cloudflare permite escolher gateway com `cf-aig-gateway-id`. Uma integração completa deve validar também o envelope de resposta e as diferenças de uso/erro. A inferência não foi exercitada nesta pesquisa.

## Version Notes

- OpenCode, branch `dev`: `83abc64a5c4e0e0a5157f2c4435d34131009a404`.
- models.dev, branch `dev`: `f85553799b09968cd6e0d4b94a65e771d8eaf397`.
- O catálogo ao vivo do Zen lista `jev-1.13` e `jev-1.13-free`; o repositório models.dev também possui `jev-latest`, ausente naquele catálogo ao vivo. Descoberta do provider deve prevalecer sobre disponibilidade presumida pelo catálogo.
- TypeSafe documenta `jev-latest` e `jev-preview` apontando para `jev-1.13.0`. IDs versionados são aceitos mesmo quando a listagem apresenta apenas aliases.

## Gotchas

- OpenCode Zen e OpenRouter são providers distintos e usam endpoints diferentes: `/zen/v1/systemone` e `/api/alpha/decisions`, respectivamente.
- A ausência no `/api/v1/models` do OpenRouter não indica ausência na Decisions API.
- `models/typesafe/` é metadado base; `providers/<provider>/models/` vincula o modelo à oferta de um provider.
- O pacote generativo padrão de um provider (`@ai-sdk/openai-compatible`, por exemplo) não implica que Jev aceite chat completions.
- Nosso setup local ainda fixa as opções TypeSafe/RedRouter e não consome esse catálogo para selecionar avaliadores. A integração existente do Redcode com models.dev já fornece a infraestrutura geral, mas precisa de metadados/adaptadores de avaliação.

## Open Questions

- Como a OpenRouter Decisions API será representada futuramente no models.dev sem misturá-la ao catálogo de chat?
- Qual o envelope autenticado de resposta e os requisitos de billing para Cloudflare em uma conta real? Não exercitados.
- Quais contratos específicos Vercel/Vivgrid exigem para avaliação? Fora do recorte detalhado.

## Source-by-Source Notes

OpenCode foi inspecionado por snapshot completo do commit, buscando Jev/TypeSafe/SystemOne no código de Console e nos runtimes. models.dev foi inspecionado nos modelos base, registros de provider, geração e testes de sincronização. Os três catálogos públicos foram obtidos separadamente para distinguir código publicado de disponibilidade anunciada. A documentação TypeSafe foi descoberta após carregar seu `llms.txt`; a documentação Cloudflare foi lida nas páginas de Jev e REST.

## Recommended Next Steps

1. Conectar o onboarding ao catálogo e às conexões existentes: provider → credencial → modelo compatível → teste.
2. Representar papel (principal/rápido/avaliador) separadamente do protocolo de execução.
3. Reaproveitar o contrato System One para TypeSafe, Zen e RedRouter, preservando o ID específico de cada oferta.
4. Implementar Cloudflare com account ID, token, gateway opcional e o envelope `/ai/run` documentado.
5. Integrar OpenRouter como transporte System One explícito usando `typesafe/jev-1.13` e `/api/alpha/decisions`, sem encaminhá-lo ao chat completions.
6. Filtrar avaliadores fora dos seletores generativos usando capacidades/protocolo explícitos, não apenas nome ou `output=0`.
