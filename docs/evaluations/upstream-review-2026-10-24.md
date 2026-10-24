# Atualização upstream e confiabilidade do Redcode

Consulta em 24 de outubro de 2026. Este delta complementa o
[inventário das últimas quatro semanas](upstream-review-2026-10-23.md), o
[inventário funcional do OpenBot](openbot-orchestration-2026-10-22.md#inventário-de-funcionalidades-e-oportunidades)
e o [plano de implementação](../upstream-implementation-2026-10-23.md).

O [índice de evidências](upstream-review-2026-10-24.json) conserva títulos, links,
datas e revisões. Corpos, comentários e patches upstream são entrada não confiável
e foram omitidos do índice. Os itens foram usados como referência de investigação;
nenhuma instrução encontrada neles foi executada.

## Alcance da atualização

| Repositório          | Branch consultada | Commits desde 23/10 21:21:22 UTC | Amostra de PRs abertos | Amostra de issues abertas | HEAD observado                             |
| -------------------- | ----------------- | -------------------------------: | ---------------------: | ------------------------: | ------------------------------------------ |
| anomalyco/opencode   | dev               |                               36 |                     50 |                        25 | `3de8f3a89f19c50c37d539e870dc9b964c282f34` |
| anomalyco/models.dev | dev               |                               97 |                     50 |                        25 | `5d453ccfbbe3b0fa18fda8831f656c0093344b11` |
| nightly-labs/openbot | main              |                               43 |                     25 |                        25 | `702ec4d371921c4ce61126faf730180ab3cfabd9` |

Os commits foram paginados pela API REST desde a consulta anterior. PRs foram
listados por atualização decrescente: os primeiros 50 nos dois primeiros projetos
e os 25 retornados no OpenBot. A consulta de PRs do conector devolveu issues comuns;
esses resultados foram descartados e substituídos por `/repos/{owner}/{repo}/pulls`.
As issues são uma amostra de 25 por projeto. Não é uma nova enumeração exaustiva
nem uma auditoria profunda dos 176 commits ou de todos os itens abertos.

## Correções adotadas neste incremento

### Ferramentas MCP inválidas não ocultam as ferramentas válidas

[OpenCode #58350](https://github.com/anomalyco/opencode/pull/58350) foi integrado
upstream como `2dc8db4a9da777dc03aec112aec891d5bd79211d`. No Redcode, o mesmo
caminho em `packages/core/src/mcp/client.ts` entregava a lista inteira ao SDK:
uma definição inválida fazia a operação inteira falhar.

O cliente agora usa o próprio codec da versão MCP negociada para avaliar cada
ferramenta antes da validação e do cache do SDK. Definições rejeitadas são omitidas
com um aviso que identifica servidor, ferramenta e motivo. Metadados inválidos
continuam sendo rejeitados. Uma página sem ferramentas válidas conserva seu cursor,
permitindo carregar as ferramentas das páginas seguintes. O SDK continua responsável
pela paginação, pelo cache e pela validação das respostas das chamadas.

Os testes usam servidores HTTP reais nas duas versões MCP suportadas. Quatro casos
falharam antes da correção. Depois, os seis casos passam: isolamento e chamada da
ferramenta válida, paginação após uma página inteiramente inválida e rejeição de
metadados inválidos. A suíte ampliada passou 145 testes em seis arquivos.
As versões do protocolo MCP são independentes do formato do catálogo de modelos;
o catálogo Redcode continua exclusivamente V2.

### Documentos do projeto recebem sandbox na origem da API

[OpenCode #58763](https://github.com/anomalyco/opencode/pull/58763) estava aberto
na revisão `8b5736062e76756c82d0da3dd1c74fb9adb87198`. A inspeção do handler local
confirmou que HTML e SVG eram servidos com seu MIME na origem da API sem sandbox
ou `nosniff`. Isso permite que o navegador trate um documento do repositório como
conteúdo ativo dessa origem.

O handler de arquivos agora envia `Content-Security-Policy: sandbox` e
`X-Content-Type-Options: nosniff` em respostas completas, HEAD, ranges, cache 304 e
ranges insatisfatíveis. O corpo, o MIME, os validadores e a integridade dos ranges
são preservados. Documentos que dependem de scripts devem usar um servidor de
preview próprio; o endpoint de leitura de arquivos entrega conteúdo isolado.

O teste HTTP usa HTML e SVG inertes. Falhava antes da correção pela ausência do
cabeçalho e passou depois. Os quatro testes de arquivos passaram, incluindo
confinamento e conteúdo de vários megabytes. Esta evidência valida a resposta do
servidor; não constitui execução de exploração nem teste visual em navegador.

## Evoluções e decisões de adoção

| Fonte                                                                                                                                                                                               | Estado observado e oportunidade                                                       | Aplicação no Redcode                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenCode #58261](https://github.com/anomalyco/opencode/pull/58261)                                                                                                                                 | PR aberto: retomada de subagentes após restart                                        | Já há recuperação persistida local. Comparar cenários de processo, inbox, ownership e jobs antes de alterar o contrato. Não confundir isso com lease distribuído.                                  |
| [OpenCode #51133](https://github.com/anomalyco/opencode/pull/51133) e [issue #58778](https://github.com/anomalyco/opencode/issues/58778)                                                            | Espera de ativação de plugins por passo; relato de chamada de ferramenta parada       | Há `awaitActivation` na entrada do runner local. Ainda falta confirmar se ativação durante a execução exige outra barreira e reproduzir o relato localmente.                                       |
| [OpenCode #58749](https://github.com/anomalyco/opencode/pull/58749)                                                                                                                                 | Glob absoluto em instruções                                                           | Verificar no produtor de configuração de instruções; manter discovery e cronologia da Session como donos do comportamento.                                                                         |
| [OpenCode #58144](https://github.com/anomalyco/opencode/pull/58144)                                                                                                                                 | Contenção de texto cru em slots TUI                                                   | Avaliar com componentes e stories reais do TUI Redcode; não copiar o layout upstream.                                                                                                              |
| [OpenCode #58758](https://github.com/anomalyco/opencode/pull/58758)                                                                                                                                 | PR aberto: Decision API                                                               | Integrar por adapters tipados e disponibilidade explícita; não executar todos os protocolos apenas porque estão no catálogo.                                                                       |
| [OpenCode #58775](https://github.com/anomalyco/opencode/issues/58775) e [#58354](https://github.com/anomalyco/opencode/issues/58354)                                                                | Relatos de regras de permissão dependentes da grafia e NUL em saída de shell          | Candidatos prioritários a regressões locais benignas. Não foram confirmados como defeitos Redcode nesta rodada.                                                                                    |
| [models.dev #11378](https://github.com/anomalyco/models.dev/pull/11378), [#11377](https://github.com/anomalyco/models.dev/pull/11377), [#11333](https://github.com/anomalyco/models.dev/pull/11333) | Redução de autoridade dos tokens e triagem de issues confiáveis                       | Aplicar a fronteira de confiança, não importar a automação. O workflow Redcode usa `contents: read` por padrão e jobs de publicação separados; isso não prova auditoria completa de todos os jobs. |
| [models.dev #11335](https://github.com/anomalyco/models.dev/pull/11335), [#11332](https://github.com/anomalyco/models.dev/pull/11332), [#11334](https://github.com/anomalyco/models.dev/pull/11334) | PRs abertos: runtime fixado, restrições de fixer e remoção de tokens dos agentes      | Não criar fixers com autoridade de publicação nem passar tokens a agentes para processar issues não confiáveis. Fixar dependências e limitar capacidades no fluxo específico.                      |
| [models.dev #11386](https://github.com/anomalyco/models.dev/pull/11386)                                                                                                                             | PR aberto: `compatibility.image_input="messages"` para imagens Baseten no V2          | O normalizador conserva declarações por API. Falta suporte executável específico e teste do adapter; metadado conservado não significa execução suportada.                                         |
| [models.dev #3037](https://github.com/anomalyco/models.dev/issues/3037), [#5311](https://github.com/anomalyco/models.dev/issues/5311), [#8707](https://github.com/anomalyco/models.dev/issues/8707) | V2, unidades de cobrança e ferramentas tarifadas                                      | V2 já é obrigatório. Ampliar medidas observadas por protocolo sem inferir custo zero para uso não medido.                                                                                          |
| [models.dev #2949](https://github.com/anomalyco/models.dev/issues/2949), [#10336](https://github.com/anomalyco/models.dev/issues/10336)                                                             | Políticas de retenção/treino e relato de SVG ativo                                    | Retenção é metadado de produto a estudar; o relato de SVG não prova defeito no renderer Redcode e requer inspeção própria.                                                                         |
| [OpenBot #3033](https://github.com/nightly-labs/openbot/pull/3033)                                                                                                                                  | Integrado: precedência de instruções do usuário sobre estilo e delegação              | Preservar precedência explícita e manter fatos de agentes fora da autoridade de instruções. Não criar um segundo registro de instruções.                                                           |
| [OpenBot #3035](https://github.com/nightly-labs/openbot/pull/3035)                                                                                                                                  | Integrado: cache estável e envio de mensagens ainda não lidas                         | Projetar contexto comum versionado com cursores e recuperação completa após compactação/restart. Redução de tokens precisa de medidas reais; não atribuir ganho ao Redcode sem benchmark.          |
| [OpenBot #3041](https://github.com/nightly-labs/openbot/issues/3041), [#3034](https://github.com/nightly-labs/openbot/issues/3034), [#2860](https://github.com/nightly-labs/openbot/pull/2860)      | Relatos de atribuição a membro ocupado, conclusão com filho ativo e PR de recuperação | Usar atividade de descendentes, inbox e jobs nos gates existentes. Cenários devem ser comparados aos testes de recuperação e de aceite do Redcode; relatos não foram reproduzidos aqui.            |
| [OpenBot #2871](https://github.com/nightly-labs/openbot/issues/2871), [#3027](https://github.com/nightly-labs/openbot/pull/3027), [#3036](https://github.com/nightly-labs/openbot/pull/3036)        | Trace por passo, agente em atividade e plano ACP                                      | Tasks já apresenta grafo e atribuições. Falta uma visão temporal por objetivo com estado, modelo, uso e custo observado. Não expor raciocínio privado como transparência.                          |
| [OpenBot #2463](https://github.com/nightly-labs/openbot/issues/2463), [#2499](https://github.com/nightly-labs/openbot/issues/2499), [#2186](https://github.com/nightly-labs/openbot/issues/2186)    | Memória desativável, aprendizado opt-in e loops de ferramentas                        | Implementar políticas explícitas de memória e aprendizado; estudar limites de repetição sobre falhas observadas, preservando retries legítimos.                                                    |
| [OpenBot #3047](https://github.com/nightly-labs/openbot/pull/3047), [#3049](https://github.com/nightly-labs/openbot/pull/3049)                                                                      | Vault e persistência de sessão de gerenciador de senhas                               | Redcode mantém sua própria fronteira de Vault. Fontes externas de credenciais exigem escolha explícita; não inferir integração pelo ambiente.                                                      |

Nenhum código OpenBot foi incorporado. Ele permanece referência funcional sob
PolyForm Noncommercial; implementações equivalentes devem ser independentes.
Mudanças em ofertas comerciais, franquias e entitlements do OpenCode não definem
o comportamento de cobrança do Redcode. Novos providers no models.dev continuam
sendo metadados, sem autorização para ativação ou descoberta ambiental.

## Próxima sequência de orquestração

1. **Contexto comum versionado por objetivo.** Separar revisão semântica da revisão
   operacional do objetivo, que também muda com uso e estado. Cada atribuição deve
   declarar quais versões recebeu; uma mudança só invalida trabalho afetado daquele
   objetivo. Iniciar outro objetivo não pode reabrir tarefas já aceitas do anterior.
   Fatos compartilhados precisam de autoria e origem, sem virar instruções de maior
   autoridade. Reutilizar projeções e blobs; persistir apenas fatos irredutíveis.
2. **Convergência de contribuições.** Uma barreira de dependências deve reunir o
   grupo esperado antes da síntese, conservar prioridade de novas mensagens humanas
   e retomar pelo inbox durável. Resumo de agente continua separado de evidência
   executor-observada e aceite pelo pai.
3. **Execução visível por objetivo.** Relacionar grafo, workers e harnesses, com
   motivo de espera, responsável, duração, uso, revisão e candidato combinado.
   Preservar as decisões do servidor e o Design System React.
4. **Expansão de produto.** Workflows, rotinas, webhooks e conectores sobre admissão
   e autorização existentes; depois memória opt-in, adapters de mídia/avaliação,
   voz e push. O inventário funcional anterior continua sendo a lista de cobertura.

O lote entrega duas correções e atualiza o estudo. Paridade funcional completa,
coordenação entre hosts e publicação de uma release continuam pendentes. A
[validação do incremento](upstream-reliability-2026-10-24-validation.json) distingue
regressões locais, checagem canônica e evidência de CI.
