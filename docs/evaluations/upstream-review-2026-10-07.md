# Revisão dos upstreams: 7 de outubro de 2026

O primeiro lote recomendado é estabilidade do TUI. Reproduzimos o repovoamento
de caches de sessões descartadas e a conversão de JSON final inválido em uma
chamada de ferramenta. Também medimos degradação com histórico grande e custo
crescente de parsing parcial. Nenhum desses resultados estabelece a causa do
travamento relatado no cliente instalado. A execução contínua de 24 horas está
em andamento; sua conclusão permanece pendente.

## Cobertura e fontes

Consultas atualizadas em 2026-10-07, entre 12:57 e 13:18 UTC. Janela de busca:
2026-09-07 a 2026-10-07. Também incluímos relatos antigos ainda pertinentes.
Esta é uma amostra orientada por risco, não uma leitura exaustiva de milhares
de issues. Foram consultadas as primeiras 100 entradas de cada busca mensal,
os 100 commits mais recentes por branch, os PRs abertos e fechados recentemente
atualizados e buscas anteriores específicas de travamento, memória e reconexão.
Issues retornadas pelo endpoint `/issues` foram separadas dos PRs.

| Projeto | Branch e referência consultadas | Última release retornada pelo endpoint |
| --- | --- | --- |
| [OpenCode](https://github.com/anomalyco/opencode) | `dev` e `v2`, separadamente; SHAs em `evidence.json` | `v1.18.35`, 6/out; não comprova a release mais recente de V2 |
| [oh-my-pi](https://github.com/can1357/oh-my-pi) | `main` | `v18.8.0`, 7/out |
| [Pi](https://github.com/earendil-works/pi) | `main` | `v1.0.4`, 5/out |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | `main` | `v2026.9.24`, 24/set; main contém mudanças posteriores |

O [catálogo de evidências](upstream-review-2026-10-07/evidence.json) registra
endpoints, horários, hashes dos recebidos, SHAs e estado das propostas
selecionadas. A consulta bruta permanece em `/tmp/redcode-upstream-final-yup901pt`.
O [registro de adoção](../upstream-adoption.md) é a referência para mudanças já
implementadas. Estado de PR e versão publicados descrevem esta consulta.

## Estado do Redcode

- Branch `main`, commit `c936a021349c16a11a6b83cb5c9484a565b852cf`.
- `packages/redcode/package.json` marca `0.72.7`; isso não implica publicação.
- Binário e serviço ativo: `0.72.2`, PID `3845508`, executável do mise em
  `~/.local/share/mise/installs/redcode/0.72.2/redcode`. Serviço com cerca de
  20 horas de uptime e aproximadamente 167 MiB de RSS na observação final.
- Nenhum processo de TUI em foreground foi identificado na inspeção inicial;
  não há captura de um cliente efetivamente travado.
- Inotify: 46 descritores e 1.798 watches legíveis de processos do usuário na
  observação anterior, contra limites de 1.024 instâncias e 524.288 watches.
  Descritores não são uma contagem perfeita de instâncias distintas; a leitura
  não cobre processos inacessíveis nem comprova o estado no momento do sintoma.
- Alterações locais preexistentes em `.gitignore`, `mise.toml` e estado Castle
  foram preservadas. Nenhum runtime, API, configuração do usuário ou serviço
  foi alterado por esta revisão.

## Reproduções e medições locais

Os probes usam `createData`, retenção de sessões, parser de ferramentas e TUI
de produção, com servidor HTTP/SSE loopback e armazenamento temporário.
Não usam providers pagos ou sessões reais. As medições são observações locais,
sem garantia estatística de ganho ou de consumo do cliente instalado.

### Retenção e lote de eventos

**R01 — Falha reproduzida.** Uma sessão já descartada volta a acumular mensagens
por `session.step.started`; o mesmo ocorre com uma filha de família descartada.
`message.update` cria novamente a entrada em
`packages/client/src/solid/data.ts:420`; a retenção em
`packages/tui/src/context/session-retention.ts:36` só descarta novamente quando
detecta nova identidade/ancestralidade excluída. Navegação e mudança de metadata
não corrigem o repovoamento de um ID já conhecido como excluído.

As fixtures observaram 1.000 e 10.000 mensagens por sessão ativa, sessão excluída
e filha excluída, sem nova limpeza destas últimas. Cem ciclos de navegação e
abertura/fechamento do conjunto mantido também deixaram o cache excluído com
mensagens. Essa fixture testa a política de retenção; os testes existentes
separados exercitam abas, navegação e preservação de submissões otimistas.

**R02 — Degradação reproduzida sob carga artificial.** O primeiro lote síncrono
com 30.000 steps, cada qual com início e fim, levou 76,6 segundos no handler.
O teste excedeu seu limite original de 60 segundos. O relógio do teste só pôde
retomar após a execução síncrona. Isso demonstra bloqueio sob esse burst; não
representa a cadência típica do provider nem um travamento espontâneo após
20 horas. A execução final usa payloads completos e deadline de observação
de 180 segundos: o mesmo volume levou 63,2 segundos, e os dois casos passaram.
Não comparar essas execuções como um ganho: nenhum handler foi alterado e
os payloads e condições de medição não são idênticos.

### Histórico carregado e teclado

Cada linha abaixo veio de um processo separado. O servidor da fixture injeta
todo o histórico, deliberadamente ultrapassando a página inicial normal de
20 mensagens. A latência é de Ctrl-O até a renderização de “Search sessions”,
com dez amostras e posterior Escape; não é uma medição de tecla física via PTY.

| Mensagens | Largura | Hidratação | Teclado mediana / P95 | RSS antes → depois |
| --- | --- | --- | --- | --- |
| 1.000 | 44 colunas | 1.194 ms | 41,7 / 50,1 ms | 283 → 365 MiB |
| 1.000 | 112 colunas | 1.205 ms | 37,0 / 44,8 ms | 291 → 381 MiB |
| 10.000 | 44 colunas | 1.938 ms | 86,9 / 90,4 ms | 273 → 461 MiB |
| 10.000 | 112 colunas | 1.693 ms | 69,2 / 75,4 ms | 269 → 537 MiB |

**R03 — Degradação observada, sem freeze.** Os atalhos e o retorno à sessão
continuaram funcionando. RSS inclui runtime Bun, app, renderer e a própria
fixture, sem GC forçado. Não atribuir todo o delta a vazamento. A montagem
visual já é limitada; o array de dados carregados e memos sobre esse array
merecem perfil separado de caches nativos/Markdown.

### Reconexão, cancelamento e ferramentas

- **R04:** 80 reconexões forçadas pelo cliente real sobre loopback entregaram
  81 eventos iniciais, terminaram conectadas e mantiveram o histórico limitado
  a 50 registros. Isso não simula troca de servidor, VPN ou suspensão real.
- **R05 — Falha reproduzida no parser:** `{"path":"/tmp/fixture` produz
  `tool-call` com `{path:"/tmp/fixture"}`; `not-json` produz `tool-call` com `{}`.
  Nenhuma ferramenta foi executada. A validação posterior de schema existe,
  mas pode aceitar um valor truncado ainda válido para aquele schema.
- **R06:** parsing real de argumentos em chunks de 100 bytes: 5.011 bytes em
  20,6 ms; 50.011 em 300,5 ms; 200.011 em 4.487,6 ms. O parser relê o acumulado
  por delta. A fixture não mede a eficácia de uma implementação alternativa.
- **R07:** no SDK MCP `2.0.0` usado pelo Redcode, duas chamadas aguardaram a mesma
  barreira de renovação de autenticação; A foi cancelada, B continuou. Após
  liberar a barreira, só B chegou autenticada ao servidor. O probe testa o
  transporte real com auth controlada, não todo o fluxo de OAuth do produto.

A primeira execução do harness teve ainda uma falha de configuração do URL
loopback no probe de reconexão. O harness foi corrigido; a repetição isolada
passou. Os resultados originais foram preservados e não entram como prova de
falha da reconexão do produto.

### Execução contínua de 24 horas

Iniciada em **2026-10-07 13:05:19 UTC**, runner PID `1835618`; término esperado
a partir de **2026-10-08 13:05:19 UTC**, com overhead de montagem e ciclos.
É um processo local separado com 10.000 mensagens carregadas, sondagem do
teclado por minuto, eventos de atividade a cada 15 segundos, evento de sessão
de segundo plano por ciclo e queda do SSE a cada dez ciclos.

Os primeiros minutos preservaram o teclado e a sessão. **Não há resultado
terminal de 24 horas nesta entrega.** Não há teste de suspensão do sistema,
troca do serviço gerenciado ou esgotamento real de inotify. São reproduções
pendentes para diagnóstico do sintoma específico, não requisitos já aprovados
por esta execução.

Saída viva: `/tmp/redcode-upstream-final-yup901pt/soak-24h/output.log`.
Estado terminal: `execution.json`, no mesmo diretório; ao terminar, o runner
grava `measurements.json`. O estado arquivado na revisão é apenas um snapshot.
O coletor mede RSS, heap, CPU ao final e atraso do event loop; não observa
diretamente a fila privada de eventos nem todos os listeners do renderer.

## Backlog por projeto

Legenda: **reproduzida** = comportamento exercitado localmente; **lacuna no
código** = diferença confirmada sem falha runtime capturada; **proposta** =
upstream aberto ou adaptação ainda não demonstrada; **coberto** = proteção
equivalente identificada, dentro dos limites especificados.

Esforço estimado de implementação: **S** até 1 dia; **M** 2–4 dias; **L** uma
semana ou mais. São estimativas de engenharia, não compromissos de prazo.
P0 é reservado a perda de dados ou execução indevida comprovada; não foi
confirmado nenhum incidente P0 no Redcode nesta revisão.

### OpenCode

| ID / prioridade / esforço | Fonte e estado | Decisão, impacto e validação necessária |
| --- | --- | --- |
| R01 / P1 / M | [#53595](https://github.com/anomalyco/opencode/pull/53595), proposta de `dev`; reprodução local independente | Corrigir a retenção de transcript nas sessões excluídas. Preservar metadata, atenção e submissões não reconhecidas. Aceitação: eventos normais não recriam transcript excluído; reabrir reidrata a sessão. Não portar o store V1 diretamente. |
| R02–R03 / P1 / M | [#53165](https://github.com/anomalyco/opencode/issues/53165), aberto, e medições locais | Relato de ~20 horas com tela ativa e atalhos inoperantes. Investigar parsing, processamento de bursts e memos sobre histórico. Falta reproduzir a perda persistente dos atalhos; não há causa upstream confirmada. |
| R08 / P1 / M | [#53291](https://github.com/anomalyco/opencode/issues/53291), aberto | Caminho nativo compartilhado em `filesystem/watcher.ts:252`: subscribe precede o timeout. Um bloqueio síncrono nativo impede a própria deadline. Validar erro EMFILE em processo descartável com limites isolados; não subir sysctl como “correção” sem reprodução. |
| R09 / P1 / M | [#53497](https://github.com/anomalyco/opencode/issues/53497), aberto | Reconexão após substituição do serviço pode afetar a sessão selecionada. Watchdog e redescoberta já existem; falta ensaio de troca de endpoint preservando rota, credencial e sessão em servidor isolado. |
| R10 / P1 / S | [#53740](https://github.com/anomalyco/opencode/issues/53740), aberto | `Stale read from <Show>` após fechar/abrir laptop em V2. Investigar ownership/disposal de Solid. Testes de teardown e teclado passaram; não há reprodução de suspensão ou desse erro no Redcode. |
| R11 / P1 / M | [#53704](https://github.com/anomalyco/opencode/pull/53704), aberto | `Job.settle` persiste antes de resolver `done`; erro de storage pode deixar waiters sem conclusão. Injetar falha em DB temporário e verificar claim, estado, notificação e admissão. Não adicionar retries que reexecutem ferramentas. |
| R12 / P2 / S | [#53546](https://github.com/anomalyco/opencode/pull/53546), incorporado | Lacuna no código: `model-resolver.ts:265` mescla metadata de API key em `body`. Remover essa projeção preservando configuração de providers e credenciais legadas. Aceitação: tenant/resourceName não viram parâmetros do modelo. |
| R13 / P2 / M | [#53601](https://github.com/anomalyco/opencode/pull/53601), incorporado | Lacuna no código: schema Anthropic não admite `between_tools`. Avaliar também binding, esforço e Bedrock. Aceitação: requests corretos nesse modo e invariantes de enabled/adaptive/disabled preservadas. |
| R05 / P1 / M | [#53685](https://github.com/anomalyco/opencode/pull/53685), aberto | Parser reproduzido: JSON incompleto é recuperado ou substituído por `{}`. Exigir JSON final completo; falhar chamadas locais não finalizadas sem executá-las. Preservar preview incremental, chamadas válidas imediatas e ferramentas hosted. Risco potencial de execução indevida; nenhum efeito externo foi exercitado. |
| R14 / P2 / M | [#53233](https://github.com/anomalyco/opencode/pull/53233), aberto | Cobertura parcial: Redcode já limita o exchange pela room disponível, mas keep.tokens continua sendo tolerância flexível, inclusive perto de zero. Testar 0, um único exchange enorme, synthetic e troca para janela menor antes de alterar a política. |
| R15 / P3 / L | [#53624](https://github.com/anomalyco/opencode/pull/53624), incorporado | Referência de credencial `external` sem key fictícia. Lacuna na union de credenciais/conexões; métodos env/command existentes não são a mesma representação. Requer Schema/Protocol/cliente gerado e provider consumidor selecionado; introduzir só com uso concreto opt-in. |
| R16 / P3 / L | [#53713](https://github.com/anomalyco/opencode/pull/53713), aberto | Descoberta genérica opt-in de metadata e defaults de gateways. RedRouter já tem catálogo remoto, limites e capacidades. Avaliar apenas a lacuna genérica; manter identidade dos modelos e catálogo vazio autoritativo. Não duplicar o cache ou a autoridade do Router. |
| R17 / P2 / S | [#53680](https://github.com/anomalyco/opencode/pull/53680), aberto | Proposta de antecipar primeiro render sem catálogo completo. Nosso sync também pede providers, mas o bootstrap/store diverge. Medir um catálogo deliberadamente lento; não transplantar o movimento de provider_next ausente no Redcode. |
| R18 / P2 / S | [#51343](https://github.com/anomalyco/opencode/issues/51343), aberto | Pending forms/permissions e shells mantêm Location; execução ativa sem eventos ainda pode expirar. Testar silêncio e TTL com relógio de fixture. Timeout de provider e espera humana são contratos distintos; não mudar indiscriminadamente a expiração. |

### oh-my-pi

| ID / prioridade / esforço | Fonte e estado | Decisão, impacto e validação necessária |
| --- | --- | --- |
| R19 / P1 / M | [#14803](https://github.com/can1357/oh-my-pi/issues/14803), aberto | Retenção de transcript antes da compaction, com 23k entries relatadas. Redcode pagina a leitura, mas histórico ativo cresce. Perfilar heap e separar dados duráveis, cache do cliente e componentes montados. Estimativas do relato não são medições nossas. |
| R20 / P2 / M | [#13632](https://github.com/can1357/oh-my-pi/pull/13632), aberto | Liberar caches derivados quando a entrada sai da área renderizada. Adaptar à OpenTUI somente após perfil; preservar expansão/source. Upstream também relata replay frio mais lento. Aceitação exige memória e custo de voltar/resize medidos juntos. |
| R21 / P2 / M | [#14705](https://github.com/can1357/oh-my-pi/pull/14705) e [#14667](https://github.com/can1357/oh-my-pi/pull/14667), incorporados | Parsing incremental, console limitado e lexing linear de Markdown. Usamos renderer/parser diferentes. Aplicar fixtures adversariais e streaming para identificar gargalo equivalente; nenhum ganho upstream é assumido aqui. |
| R22 / P2 / S | [#14711](https://github.com/can1357/oh-my-pi/pull/14711), incorporado | Registry do Redcode já usa sliding queue + debounce de 100 ms em `tool/mcp.ts`. Refresh por servidor ainda ocorre por notificação sob lock. Medir bursts de list_changed; propor coalescing adicional só se houver chamadas redundantes. |
| R23 / P2 / S | [#14781](https://github.com/can1357/oh-my-pi/pull/14781), aberto | Metadata descoberta sem mudança de contextWindow precisa valer na próxima chamada. Resolver do Redcode consulta o catálogo por resolução; não há guard equivalente por contextWindow identificado. Testar tier-only, nome, capacidades e remoção do modelo antes de chamar de bug. |
| R24 / P3 / S | [#14796](https://github.com/can1357/oh-my-pi/pull/14796), aberto | Skills/comandos instalados durante sessão. Watchers, reload e eventos já existem em `config/plugin/skill.ts`. Confirmar visibilidade no slash menu e instructions sem prefix churn desnecessário. Não adicionar RPC só por paridade de nome. |
| R25 / P2 / M | [#14751](https://github.com/can1357/oh-my-pi/pull/14751), aberto | Proteção de cache por content blocks, além de tokens. Nossa poda reescreve a cópia model-facing e não tem esse guard de cache quente. Medir hit/read/write antes e depois; não afirmar economia apenas pelo limite “16 blocks” upstream. |
| R26 / P2 / M | [#14252](https://github.com/can1357/oh-my-pi/pull/14252), aberto | Redução de objetos/catalog/bytecode retidos. Perfil local primeiro; lazy imports já são convenção. Benefício de RSS relatado no omp não comprova benefício no Bun/OpenTUI do Redcode. |
| R27 / P2 / S | [#14730](https://github.com/can1357/oh-my-pi/pull/14730), aberto | FIFO/device bloqueando leitura LSP. Tool LSP já verifica isFile; client.notify.open relê depois, deixando possível corrida de troca do arquivo. Não reproduzida. Testar em processo descartável antes de adicionar complexidade para race rara. |

### Pi

| ID / prioridade / esforço | Fonte e estado | Decisão, impacto e validação necessária |
| --- | --- | --- |
| R06 / P2 / M | [#9461](https://github.com/earendil-works/pi/pull/9461), aberto | Parsing parcial por delta existe e foi medido. Avaliar snapshot limitado por versão/cadência preservando preview e parsing final rigoroso. Evitar getter lazy que seria lido pelo mesmo consumidor em cada delta e eliminaria o ganho. |
| R28 / P2 / M | [#9807](https://github.com/earendil-works/pi/issues/9807) e [#6665](https://github.com/earendil-works/pi/issues/6665), abertos | Scrollback completo e Segmenter/Markdown custosos. Redcode já tem tail mount e renderer nativo. Reutilizar cenários de stress, sem copiar o renderer Pi. Caches do nosso renderer ainda precisam de heap/profile específicos. |
| R29 / P2 / S | [#8066](https://github.com/earendil-works/pi/pull/8066), aberto | Cache de linhas visuais do editor. Testar edição e navegação em prompts grandes no editor OpenTUI; não existe prova de que ele recalcula como o editor Pi. |
| R30 / P2 / S | [#10526](https://github.com/earendil-works/pi/issues/10526), aberto | Startup tools bloqueado por resources. Redcode conecta/lista tools antes; resources e prompts têm caminhos separados. Coberto no desenho. Adicionar cenário de resources/list lento apenas se o bootstrap global mostrar bloqueio. |
| R07 / P1 de investigação / S | [#10598](https://github.com/earendil-works/pi/issues/10598), aberto | Transporte SDK local passou cancelamento A durante auth, com B preservada. Não portar fix do pi-mcp, outra implementação. Completar prova end-to-end com McpClient/OAuth antes de qualquer alegação de execução pós-cancelamento aqui. |
| R31 / P2 / S | [commit 2db5e359b](https://github.com/earendil-works/pi/commit/2db5e359b), incorporado | Manager MCP responsivo e tentativa antiga invalidada no disable/re-enable. Redcode usa locks e guards de cliente live. Testar UI enquanto servidor está lento, cleanup e tool previamente preparado antes de mudar a concorrência. |
| R32 / P3 / M | [#10577](https://github.com/earendil-works/pi/pull/10577), aberto | Compaction em prefixo cacheado já tem ferramentas preservadas e toolChoice none no Redcode. Novidade útil: probes por modelo e gate de custo/fallback. Exige usage observado com credenciais autorizadas; não habilitar por default nem prometer economia sem medição. |

### Hermes Agent

| ID / prioridade / esforço | Fonte e estado | Decisão, impacto e validação necessária |
| --- | --- | --- |
| R33 / P1 de investigação / M | [#108154](https://github.com/NousResearch/hermes-agent/pull/108154), aberto | Budget por bytes/frames da fila WebSocket. Redcode usa SSE para eventos principais; pending batch do cliente não tem budget explícito. Medir consumidor lento e bursts. Adaptação exige snapshot/resync para não perder fatos; não copiar close code de WS. |
| R34 / P2 / M | [#101633](https://github.com/NousResearch/hermes-agent/pull/101633), incorporado em 2/set | DB lock fora do event loop Python elimina freeze relatado de 90s. Referência histórica pertinente. Redcode usa Bun/Effect/SQLite; mapear chamadas síncronas e waits, sem portar executor Python ou atribuir mesma causa. |
| R35 / P2 / S | [#101635](https://github.com/NousResearch/hermes-agent/pull/101635), incorporado em 2/set | Deadline de leitura de contexto em storage remoto. Reads assíncronos no Redcode não provam cancelamento de FS preso. Fixture com fonte indisponível deve preservar último valor de instructions e não bloquear teclado. Sem teste NFS real realizado. |
| R36 / coberto / S | [#134423](https://github.com/NousResearch/hermes-agent/issues/134423), aberto | Watermarks de sidecars mortos acumulando replay. Não identificamos mapa equivalente; connection history é limitada e 80 reconexões passaram. Sessões históricas/metadados têm outras políticas e não são esse replay map. |
| R37 / coberto no desenho / S | [#134239](https://github.com/NousResearch/hermes-agent/issues/134239), aberto | Dupla compaction por snapshot stale. Redcode serializa drains por Session e admite inbox durável. Suite de coordinator passou. Falta cenário combinado fresh input durante compaction para fechar prova comportamental específica. |
| R38 / P2 / S | [#134261](https://github.com/NousResearch/hermes-agent/issues/134261), aberto | Policy block classificado como overflow perde persistência. Classificação estruturada já separa esses motivos. Acrescentar replay de “Content Exists Risk” e garantir admissão persistida e ausência de compaction indevida. Não assumir bug pelo tamanho da sessão. |
| R39 / P3 / M | [#134541](https://github.com/NousResearch/hermes-agent/pull/134541), aberto | Preservar signed thinking em proxies confiáveis, opt-in. Nosso lowering já considera metadata/assinaturas; validar contrato por adapter e rejeição de assinatura. Não adotar o número de ~35% de tokens como economia do Redcode. |
| R40 / adiado | [#134432](https://github.com/NousResearch/hermes-agent/pull/134432), incorporado | Escrita automática em skills não é direção adotada. Propostas de aprendizado precisam de ownership, evidência e escolha explícita. Integração de catálogo/memória externa é opt-in e exige proposta própria. |

## Lotes prontos para a próxima implementação

### Lote 1 — estabilidade do TUI

Implementar primeiro R01. O cliente deve distinguir transcript retido/carregado
de metadata conhecida e de submissão otimista local. Eventos de sessões fora
da retenção mantêm status/atenção sem materializar todo o transcript; reabrir
faz sync normal. Não limpar inputs locais não reconhecidos ou interromper
execução de background. Não aplicar um corte arbitrário ao histórico ativo.

Aceitação: 10k eventos em root/filha excluídas deixam o transcript ausente;
famílias abertas e recentes mantêm o comportamento; reabrir restaura histórico;
permissões, forms e optimistic echo/reject continuam funcionando. Acrescentar
cenário combinado de streaming, navegação e reconexão. Medir memória e teclado
antes/depois com os mesmos processos e inputs.

Depois perfilar R02–R03 e investigar R08–R11. Qualquer correção de watcher,
ownership Solid ou storage terá reprodução própria antes de adoção. O soak
pendente é a referência temporal; o burst não o substitui.

### Lote 2 — compatibilidade e ferramentas

R12: separar metadata/configuração de credenciais do corpo de inferência,
preservando Azure/Cloudflare e import legado. R05: separar preview parcial de
argumentos finais completos, terminar chamadas locais inacabadas como falha
não executada e preservar continuidade do modelo. R13: adicionar between_tools
com os contratos de binding/effort e respectivos adapters.

Aceitação: requests de providers e credenciais em fixtures reais; chamada
válida executada uma vez; JSON truncado não despachado; tools hosted não
convertidos em execução local; interrupção não deixa estado streaming preso.
Verificar os novos cenários também em replay de histórico e compaction.

### Lote 3 — desempenho e funcionalidades comprovadas

R06 e R25 primeiro: reduzir parsing por delta e provar preservação de cache.
R20/R22/R23 somente após perfil ou fixture que demonstre custo/falha local.
R15/R16/R32 são propostas opt-in dependentes de um consumidor e de evidência
de valor; não são features aprovadas automaticamente por esta revisão.

## Validação, limites e continuidade

- Client: 14 testes passaram (SSE watchdog, keepalive, resync, eviction,
  optimistic submissions e inbox race).
- TUI: 17 testes passaram (mount budget, navegação narrow/wide, keymap scopes,
  retenção e cleanup de plugins).
- Core: 50 testes passaram (coordinator, compaction restrita e MCP OAuth).
- Probes isolados de render, reconexão, parser e SDK estão registrados com
  seus resultados e limitações em
  [measurements.json](upstream-review-2026-10-07/measurements.json).
  Dez testes de observação passaram; isso não significa correção dos defeitos
  cujos comportamentos indesejados foram explicitamente observados.
- `bun run check` passou: lint sem warnings/erros; 24 tarefas de typecheck
  bem-sucedidas, todas reaproveitadas do cache Turbo. Templates de pesquisa
  fora de packages foram exercitados pelo Bun, sem typecheck próprio.
- Não há atribuição causal ao travamento do cliente instalado, resultado
  final de 24h, teste de sleep/VPN real, nem validação de failover do serviço.
- Não foram feitas correções de produto, mudanças de API, upgrades, restarts,
  branches, commits, PRs ou releases. Não há Changeset porque o comportamento
  público não foi alterado.

Para repetir, usar o runner documentado no diretório de evidências. Para fechar
esta rodada, após o soak terminar, conferir `exit_code`, `soak-finished` e
continuidade/latência dos ciclos, arquivar as medições finais e atualizar este
relatório. Sem esses sinais a validação temporal continua pendente.
