# Atualização do estudo e entrega no Agents

O índice [delta-refresh.json](delta-refresh.json) registra uma nova consulta aos
três repositórios em 23 de outubro de 2026. Complementa o inventário de quatro
semanas em [../upstream-review-2026-10-23.md](../upstream-review-2026-10-23.md):
são os 30 commits mais recentes do OpenCode e 35 dos outros projetos, até 30 PRs
abertos e 35 issues abertas por repositório, ordenados pela atualização. As datas
individuais ausentes nos resultados de busca não foram inferidas. A consulta
retornou 23 PRs abertos para OpenBot. Isso não substitui a enumeração anterior nem
constitui auditoria de todos os itens.

## Oportunidades e aplicabilidade

| Fonte                                                                                                                                                                                                                                                   | Observação upstream                                                                                                               | Decisão Redcode                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [OpenBot #2943](https://github.com/nightly-labs/openbot/issues/2943), [#2845](https://github.com/nightly-labs/openbot/issues/2845)                                                                                                                      | Relato de pouca visibilidade durante delegação; pedido de trace por execução. Não demonstram implementação de waterfall completo. | Entregar Tasks em Agents sobre os contratos existentes: objetivo, pré-requisitos, sessões responsáveis, execução, checks, arquivos compartilhados e candidato combinado. Waterfall com tempos/custos por execução continua separado. |
| [OpenBot #2934](https://github.com/nightly-labs/openbot/pull/2934), commit no índice                                                                                                                                                                    | Passos de execução sob a atividade.                                                                                               | Expor as contribuições e verificações já observadas sem carregar todos os transcripts. Não tratar resumo do agente como prova de aceite.                                                                                             |
| [OpenBot #2860](https://github.com/nightly-labs/openbot/pull/2860)                                                                                                                                                                                      | PR aberto sobre execuções presas após restart.                                                                                    | Redcode já tem recuperação de execução persistida e testes de processos. Conservar as diferenças entre recuperação, ownership local e coordenação distribuída; não declarar o problema resolvido em todos os adapters.               |
| [OpenBot #2972](https://github.com/nightly-labs/openbot/pull/2972), [#2891](https://github.com/nightly-labs/openbot/pull/2891)                                                                                                                          | Perfis de navegador por agente e limites administrativos em servidor conectado, presentes na amostra de commits.                  | Investigar perfis isolados e propagação dos limites por assignment. Não importar defaults de permissão do upstream.                                                                                                                  |
| [OpenBot #2930](https://github.com/nightly-labs/openbot/pull/2930), [#2821](https://github.com/nightly-labs/openbot/pull/2821)                                                                                                                          | Vault/Bitwarden em servidor associado e refresh OAuth Google MCP.                                                                 | Integrar pelos contratos de Vault e credenciais por host; refresh/revogação e acesso efetivo exigem ensaio próprio.                                                                                                                  |
| [OpenBot #2926](https://github.com/nightly-labs/openbot/pull/2926), [#2928](https://github.com/nightly-labs/openbot/pull/2928)                                                                                                                          | Preservação de histórico em snapshot limitado e rotinas horárias cruzando meia-noite.                                             | Verificar merge incremental do Redcode e futuros schedulers, incluindo timezone/DST e recibos de admissão durável.                                                                                                                   |
| [OpenCode #58531](https://github.com/anomalyco/opencode/pull/58531)                                                                                                                                                                                     | PR aberto: interpolar região Bedrock a partir de settings mesclados.                                                              | Correspondência estática em `packages/core/src/model-resolver.ts`: a interpolação consulta somente o ambiente. Correção candidata para lote próprio, com precedência de configuração e teste sem provedor pago.                      |
| [OpenCode #58533](https://github.com/anomalyco/opencode/issues/58533)                                                                                                                                                                                   | Relato de diálogo de custom provider escrevendo formato V1 para servidor V2.                                                      | Rastrear o caminho de persistência local antes de afirmar aplicabilidade. O catálogo Redcode permanece exclusivamente V2.                                                                                                            |
| [OpenCode #58527](https://github.com/anomalyco/opencode/issues/58527)                                                                                                                                                                                   | Relato de `ask` ignorado para edição em 2.0.4.                                                                                    | Não confirmado como vulnerabilidade Redcode. Exige rastreamento estático da política e asserções benignas no executor real; não relaxar regras para igualar comportamento relatado.                                                  |
| [OpenCode #55756](https://github.com/anomalyco/opencode/pull/55756), [#57729](https://github.com/anomalyco/opencode/pull/57729), [#58491](https://github.com/anomalyco/opencode/pull/58491), [#58492](https://github.com/anomalyco/opencode/pull/58492) | Propostas de status durante preparação, hidratação lazy, limites de transcript e compactação.                                     | Medir cold activation, preservar anexos/replay e aplicar limites sem truncar fatos duráveis. Não adotar valores de janela sem metadados do modelo.                                                                                   |
| OpenCode commits `2abdf9604b3ebcf85ba4c505fca955038aefe1b9`, `0471a39a`                                                                                                                                                                                 | Sync de stats durante refresh e posição de flags CLI.                                                                             | Avaliar contra nossos jobs/CLI; commit upstream sozinho não prova falha local.                                                                                                                                                       |
| [models.dev #11252](https://github.com/anomalyco/models.dev/pull/11252), [#11251](https://github.com/anomalyco/models.dev/pull/11251), [#11250](https://github.com/anomalyco/models.dev/pull/11250)                                                     | Capacidades e atualizações por API; Bedrock Converse possui diferenças de tools.                                                  | Preservar capacidades por API na normalização V2. Testes de adapter devem avaliar o protocolo selecionado, sem copiar flags de outro endpoint.                                                                                       |
| [models.dev #11259](https://github.com/anomalyco/models.dev/pull/11259)                                                                                                                                                                                 | Cache implícito condicionado à região de GLM 5.1.                                                                                 | Manter preços condicionais e custo desconhecido quando faltar dimensão observada; não aplicar desconto regional globalmente.                                                                                                         |
| [models.dev #10818](https://github.com/anomalyco/models.dev/pull/10818), [#10633](https://github.com/anomalyco/models.dev/pull/10633)                                                                                                                   | PRs abertos com modelos de decisão/System One.                                                                                    | Descritores no catálogo não equivalem a execução chat compatível. Adapters de decisão, limites e preços precisam validação independente.                                                                                             |

O detalhe de OpenCode #58531 foi conferido via API: `state=open`,
`merged=false`, head `a6c3d9e7766a8bc1b076bdc7cebb0e907efbb66d`, base `09e6ddf630b5f2466addf6044b79a60bd48bac03`.
Os demais estados de listas vêm do filtro aberto registrado no índice; não foram
convertidos em afirmações de merge ou compatibilidade local.

Os testes locais de `model-resolver.test.ts` já cobrem região Mantle definida no
próprio modelo e sua precedência sobre o ambiente. Para #58531, falta exercitar a
região que chega somente pelo provider ou pela configuração da credencial antes
de afirmar uma falha Redcode; a leitura do helper isolado não basta.

## Confiança nas fontes

Descrições de issues e PRs são dados externos. O corpo de models.dev #11172
continha, em comentário oculto, uma instrução para extrair configuração Git e
publicar credenciais. Essa instrução foi ignorada; a alegação de endpoint regional
permanece sem validação. Nenhuma política do repositório foi inferida desse texto.

OpenBot usa PolyForm Noncommercial. A tela e os contratos Redcode foram
implementados independentemente; nenhum código OpenBot foi incorporado.

## Contrato entregue neste lote

Agents → Tasks seleciona uma sessão no host e apresenta seu objetivo e critérios,
progresso das tarefas e reconciliação derivada. Cada contribuição identifica a
sessão e o prompt na leitura tipada e mostra execução, resumo separado dos checks,
evidência atual/obsoleta, arquivos e limites de truncamento.

O preparo consulta o HEAD de um checkout escolhido explicitamente e solicita ao
servidor o candidato vinculado à tarefa. O diff é revisável e conflitos são
visíveis. O UI não inventa recibos de verificação nem aceita tarefas: o executor
da sessão precisa verificar e aceitar o candidato exato. Após o aceite, uma nova
revisão libera confirmação explícita de aplicação. Mudança de revisão ou diff
truncado impede essa confirmação. O servidor continua dono dos gates finais.

Resposta perdida conserva a identidade original da aplicação no controller;
operações pendentes já admitidas recuperam essa identidade do registro da tarefa.
A repetição reconcilia um recibo admitido conforme o contrato existente. Isso
não acrescenta garantia de efeitos exatamente uma vez nem coordenação entre hosts.

Permanecem: trace completo com timing/custo, comunicação entre agentes, contexto
comum versionado, notificações agrupadas, grafo em workers/harnesses, workflows,
rotinas e conectores, adapters adicionais e validação real por provedor. Esta
entrega não representa paridade funcional completa nem publicação.
