# Auditoria de qualidade, controle e desempenho do CLI

Resolução: [implementação, regressões e limites](../../specs/cli-reliability.md). Os achados abaixo preservam o estado observado antes das correções; a validação do conjunto corrigido fica no documento de resolução.

Data local: 2026-09-07. Checkout: `c8ab670fe46bbc0a1319cf0eeecf21a74a816ef6` (`HEAD`, `main` e `origin/main` no início da auditoria), incluindo alterações locais e arquivos novos de Goal/Plan/Design. O checkout contém trabalho anterior de outras frentes; esta auditoria não avalia o binário instalado como se fosse esse mesmo artefato.

## Avaliação

A implementação tem primitivas úteis: admissão durável, coordenação por Session, revisões com hash, compare-and-swap, políticas de ferramentas, limites de histórico e testes com browser real. A fragilidade está nas fronteiras entre essas peças. Hoje, conclusão da ferramenta pode ser confundida com conclusão do trabalho; término de `plan_exit`, com autorização para Build; timeout, com processo encerrado; reconexão, com estado atualizado; permissão de publicar, com permissão de ler todas as dependências.

Por isso, ainda não considero o estado DONE uma garantia suficiente de entrega verificada, nem os controles de cancelamento e recuperação suficientemente uniformes para uso prolongado. A prioridade é tornar essas promessas verdadeiras antes de expandir automação, memória ou o catálogo de ferramentas.

A auditoria encontrou **14 achados**: 11 defeitos reproduzidos em fixtures, dois confirmados por código sem jornada completa de TUI e um problema de responsividade do backend medido com profiling. Os achados de Standards, Spec e runtime permanecem separados abaixo. P1 indica prioridade alta; P2 indica impacto importante com gatilho mais restrito ou recuperação disponível.

## Método e limites

- Dois revisores independentes examinaram Standards e Spec; a investigação principal examinou processos e GIF. O revisor de Spec também verificou lifecycle e recuperação da TUI.
- Base documental: `AGENTS.md`, `specs/goal-modes.md`, `specs/design/`, `specs/terminal-freeze.md` e a comparação anterior em `2026-09-07-goal-modes-comparison.md`.
- Dez testes adversariais executaram código real de Core, legacy e providers da TUI com DB/servidores temporários, respostas determinísticas do provider e dados artificiais. As asserções passaram porque reproduziram defeitos; isso não representa dez garantias de correção.
- Quatro ensaios verificaram cancelamento/timeout de processos próprios. Quatro exports SVG→GIF mediram timers; outros quatro rodaram sob CPU profiler. Bun 1.4.1, Linux, Chromium real.
- Não houve chamadas pagas a modelos, leitura de segredos reais, alterações de configuração, reinício de servidores do usuário ou mudanças em código de produção. Os probes temporários foram arquivados em `/tmp` e removidos do checkout.
- A revisão auxiliar de Standards foi interrompida por um filtro de segurança após concluir dois probes com dados artificiais. Seus resultados foram consolidados a partir dos logs concluídos e do código; a etapa interrompida não foi repetida.
- O host tinha outras cargas. Os tempos são observações locais, não SLA nem comparação controlada de versões. O travamento espontâneo relatado pelo usuário não foi capturado nesta auditoria.

## Standards

### ST1 — P1: identidade de feedback atravessa a fronteira de escrita do Design

**Reproduzido.** `SessionMessage.ID` valida apenas o prefixo; `Design.Feedback` reutiliza esse schema. O identificador entra diretamente no caminho do arquivo de whiteboard. No teste, um ID aceito fez um JSON artificial ser gravado fora do armazenamento do Design, ainda dentro do projeto temporário.

Evidência: `outsideDesignStorage: true`, arquivo `.red/audit-escaped-0.excalidraw`. O resultado demonstrado é uma escrita de JSON com sufixo imposto pelo formato; não foi demonstrada execução de código nem escrita irrestrita de qualquer conteúdo.

Fontes: [schema de mensagem](../../packages/schema/src/session-message.ts), linha 12; [schema Design](../../packages/schema/src/design.ts), linha 115; [store](../../packages/core/src/design/store.ts), linhas 293–300. A fronteira contradiz a área de artefatos prevista para Design em `specs/goal-modes.md`.

**Correção recomendada:** identidade opaca com charset validado e verificação de contenção do caminho canônico na fronteira de escrita. Validar ambos evita depender de todos os chamadores conhecerem regras de filesystem.

### ST2 — P1: build de Design contorna autorização de leitura das dependências

**Reproduzido no store/build; caminho de permissão confirmado por código.** Um protótipo React importou um `.env.audit` artificial e seu marcador apareceu no bundle publicado. O build real não consultou o serviço de permissão de leitura. A ferramenta exige `design_preview` e ownership do documento, mas não autoriza o grafo de arquivos importados.

A política normal pede autorização para `*.env` e `*.env.*`. A autorização genérica para publicar não descreve ao usuário a incorporação desses arquivos. O probe chamou `store.publish` diretamente; a ausência de autorização transitiva no caminho da ferramenta foi verificada estaticamente. Nenhum segredo real ou envio externo foi usado. `configFile: false` já existe: o achado não é execução de configuração arbitrária do Vite.

Fontes: [build](../../packages/core/src/design/build.ts), linhas 21–100; [ferramenta](../../packages/core/src/tool/design.ts), linhas 199–203; [política](../../packages/core/src/plugin/agent.ts), linhas 122–125.

**Correção recomendada:** resolver dependências com autorização por caminho canônico e construir a partir de um conjunto aprovado de fontes. Preservar reutilização de arquivos de produto explicitamente autorizados. Isolar o build em processo/worker ajuda a controlar recursos, mas isolamento sem política de filesystem não resolve essa leitura.

## Spec

### SP1 — P1: Goal conclui antes dos efeitos de ferramentas irmãs

**Reproduzido com SessionRunner, registro canônico e GoalTools reais.** Uma resposta chama `goal_complete` e uma ferramenta de edição demorada. O runner inicia ferramentas concorrentemente. A revisão conclui, grava DONE, e a ferramenta irmã ainda altera o arquivo verificado. Ao retornar do runner, o Goal continua DONE com hash diferente do arquivo final.

No fixture, a ferramenta irmã espera observar DONE antes de escrever. Isso determina a ordem sem depender de sleeps; a revisão usa resposta PASS determinística, sem modelo externo.

Resultado: `goalStatus: done`, um turno de provider, hashes distintos antes/depois. Viola “Changed files, newly pending work ... invalidate an outstanding review” em `specs/goal-modes.md`.

Fontes: [runner](../../packages/core/src/session/runner/llm.ts), linhas 304–349 e 526–531; [goal_complete](../../packages/core/src/tool/goal.ts), linhas 44–53 e 131–151.

**Correção recomendada:** a ferramenta produz uma proposta de conclusão; o runner aceita a proposta em uma fronteira estável, após os efeitos irmãos terminarem, revalidando evidências, revisão do Goal e entradas admitidas. Outra checagem dentro da ferramenta mantém uma janela de corrida.

### SP2 — P1: steering admitido durante a revisão não invalida DONE

**Reproduzido.** Durante a revisão, `SessionInput.admit` persistiu uma correção pedindo incluir rollback e não concluir ainda. A revisão terminou com `goalStatus: done` e `pendingSteer: true`. O helper que declara verificar trabalho admitido só examina todos e jobs de Design; a admissão não altera a revisão do Goal.

Fontes: [goal_complete](../../packages/core/src/tool/goal.ts), linhas 44–53 e 139–151; contrato de admissão em `AGENTS.md`; `specs/goal-modes.md`.

O probe isolou a admissão durável sem advisory wake. **Não prova perda permanente da mensagem:** um wake normal pode processá-la depois, porém o Goal já foi concluído, sem sua continuidade/orçamento ativo.

**Correção recomendada:** incluir a sequência/geração de admissão no aceite da conclusão. Preservar a diferença entre steer e queue; uma tarefa explicitamente enfileirada para depois não deve ser confundida com correção do trabalho atual.

### SP3 — P2: orçamento legacy não conta cada tentativa real do provider

**Reproduzido com SessionPrompt e endpoint HTTP artificial.** Goal com `maxTurns: 1`, resposta HTTP 503 seguida de sucesso: ocorreram duas requisições primárias, mas `turns.used` permaneceu 1. A chamada independente do juiz não entra nessa contagem de requisições primárias.

Fontes: [prompt](../../packages/redcode/src/session/prompt.ts), linha 1518; [processor](../../packages/redcode/src/session/processor.ts), linhas 681 e 705–719; [retry](../../packages/redcode/src/session/retry.ts). Contradiz a contagem de provider attempts declarada em `specs/goal-modes.md`.

**Correção recomendada:** contabilizar/admitir orçamento na fronteira de cada tentativa real ou expor orçamentos distintos e limitados de turnos lógicos e retries, com nomes inequívocos.

### SP4 — P2: falha de provider deixa Goal ativo com execução ociosa

**Reproduzido com resposta HTTP 400.** Depois de `prompt.loop` retornar: `primaryProviderAttempts: 1`, `turnsUsed: 1`, `goalStatus: active`, `executionStatus: idle`. A execução acabou e o objetivo mantém aparência de atividade.

Fontes: [prompt](../../packages/redcode/src/session/prompt.ts), linha 1415; [processor](../../packages/redcode/src/session/processor.ts), linhas 639–661.

**Correção recomendada:** registrar motivo tipado de bloqueio/falha ao terminar a execução, preservando retomada explícita. Esse estado incoerente pode parecer sessão travada, mas não demonstra bloqueio do terminal.

### SP5 — P2: recuperação de orçamento recomenda comandos ausentes na TUI

**Confirmado por código.** A mensagem de esgotamento recomenda `/goal budget N` e `/goal resume`. A TUI registra `/goal`, `/goal-pause`, `/goal-resume` e `/goal-drop`; `/goal` abre um diálogo sem argumentos e não existe chamada TUI para `goalBudget`. Retomar preserva o orçamento esgotado, que volta a pausar no início da execução.

Fontes: [mensagem](../../packages/redcode/src/session/goal.ts), linhas 300–301; [comandos TUI](../../packages/tui/src/routes/session/index.tsx), linhas 634–696; [handlers](../../packages/redcode/src/server/routes/instance/httpapi/handlers/session.ts), linhas 299–340. O endpoint de orçamento existe, assim como o controle no App.

**Correção recomendada:** oferecer edição de orçamento na TUI, verificar saldo antes de retomar e gerar instruções a partir dos comandos disponíveis naquele cliente.

### SP6 — P2: custo de revisão descartada desaparece da contabilidade

**Reproduzido.** O reviewer retornou uso de 15 tokens enquanto uma pausa invalidava o resultado. A pausa foi corretamente preservada, mas o Goal ficou com `tokens: 0`, `reviews: 0`. O consumo só é persistido junto do resultado aceito pelo compare-and-swap.

Fonte: [goal_complete](../../packages/core/src/tool/goal.ts), linhas 131–151. Viola a inclusão de uso auxiliar reportado pelo provider em `specs/goal-modes.md`.

**Correção recomendada:** persistir recibo da tentativa e uso independentemente da aceitação do parecer. Um resultado obsoleto não deve desfazer pausa nem desaparecer dos custos.

### SP7 — P1: Plan-only muda o composer da TUI para Build

**Confirmado por código; jornada completa ainda não executada.** O backend conclui `plan_exit` com “Plan ready” quando o Goal termina em Plan, sem autorizar Build. A TUI interpreta qualquer `plan_exit` concluído como troca para Build. O próximo prompt usa o agente selecionado no composer.

Fontes: [Plan legacy](../../packages/redcode/src/tool/plan.ts), linhas 37–42; [evento TUI](../../packages/tui/src/routes/session/index.tsx), linhas 357–373; [envio do prompt](../../packages/tui/src/component/prompt/index.tsx), linhas 1034 e 1138–1174. Contradiz “A Goal started in Plan stays there” em `specs/goal-modes.md`.

**Correção recomendada:** refletir a transição autorizada/estado efetivo da Session. Nome de ferramenta e status completed não são contrato de mudança de modo. Acrescentar a jornada da TUI à verificação existente do backend.

## Runtime e desempenho

### RT1 — P1: cancelamento/timeout pode esperar indefinidamente por processo resistente a SIGTERM

**Reproduzido em AppProcess real.** Um filho artificial registrava SIGTERM, mas permanecia vivo. Sem `forceKillAfter`, tanto abort quanto timeout ficaram pendentes até a limpeza externa do próprio probe. O código não impõe outra escalada nessa situação.

| Cenário | Resultado observado |
| --- | --- |
| Abort, configuração padrão | Pendente após 769,5 ms; SIGTERM recebido |
| Abort, `forceKillAfter: 100 ms` | Encerrado em 105,8 ms |
| Timeout de 250 ms, padrão | Pendente após 754,9 ms; SIGTERM recebido |
| Timeout de 250 ms, escalada de 100 ms | Encerrado em 337,2 ms |

Esses tempos delimitam a observação do probe. A possibilidade de espera sem prazo decorre também do finalizer: ele aguarda saída sem escalada quando a opção está ausente. A limpeza de emergência atuou apenas sobre os grupos dos filhos criados pelo teste.

Fontes: [spawner](../../packages/core/src/cross-spawn-spawner.ts), linhas 382–401; [AppProcess](../../packages/core/src/process.ts), linhas 147–196. **Bash Core já configura escalada de três segundos** em [bash.ts](../../packages/core/src/tool/bash.ts), linha 163. Os novos gates de Goal e a instalação de Chromium não configuram essa opção: [goal.ts](../../packages/core/src/tool/goal.ts), linhas 90–97; [renderer](../../packages/core/src/design/renderer.ts), linhas 50–59.

**Correção recomendada:** política comum de término para processos pertencentes ao runtime, com cancelamento, escalada e cleanup delimitados. Não depender de cada novo chamador lembrar uma opção. Esse caso demonstra operação presa, não a causa do incidente original do shell.

### RT2 — P1: listeners sobrevivem à desmontagem e ampliam o custo de cada evento

**Reproduzido com SDKProvider e useEvent reais.** Após 101 montagens/desmontagens de um consumidor, um evento disparou 101 callbacks, com zero consumidores montados. `useEvent` retorna o remover, mas não o vincula ao lifecycle de Solid. Consumidores reais em Session e Prompt ignoram esse retorno. O Set só é limpo quando o SDKProvider inteiro é destruído.

Fontes: [useEvent](../../packages/tui/src/context/event.ts), linhas 12–29; [SDK](../../packages/tui/src/context/sdk.tsx), linhas 35–46 e 141–145; [Session](../../packages/tui/src/routes/session/index.tsx), linhas 357 e 417; [Prompt](../../packages/tui/src/component/prompt/index.tsx), linha 257.

O teste demonstra retenção e crescimento linear do número de callbacks. Não mediu bytes retidos nem uma curva de latência por navegação, e não montou a rota Session completa. Os filtros de tipo também são executados durante cada fanout.

**Correção recomendada:** vincular inscrição ao owner/cleanup ou corrigir explicitamente todos os consumidores, mantendo remover idempotente para usos imperativos. Critério: consumidor desmontado recebe zero eventos futuros.

### RT3 — P2: exclusão de sessões mantém caches de mensagens e partes

**Reproduzido no SyncProvider real.** Cem sequências de criar mensagem/parte e excluir Session deixaram lista de sessões vazia, mas cem caches de mensagens e cem donos de partes. O fixture forneceu aproximadamente 1 MB de texto; não é medição de RSS.

Fontes: [sync](../../packages/tui/src/context/sync.tsx), linhas 298–309, 386–405. A exclusão remove metadados da lista, sem liberar os outros mapas. `message.removed` também não remove as partes correspondentes.

**Correção recomendada:** eviction por Session com limpeza dos donos de partes e estados associados, mais limite para sessões inativas. A janela normal de mensagens por Session já é limitada a cem; esse limite não resolve retenção entre sessões.

### RT4 — P1: recuperação de conexão preserva transcript desatualizado

**Reproduzido no caminho de refresh.** Após hidratar uma Session, o servidor artificial mudou seu transcript. Executar `bootstrap`, como faz o reconnect, e depois `session.sync` ainda manteve “BEFORE gap”; o endpoint de mensagens foi lido uma única vez. `fullSyncedSessions` impede nova hidratação e nunca é invalidado nesse fluxo.

Fontes: [sync](../../packages/tui/src/context/sync.tsx), linhas 583–587, 627 e 692. Bootstrap também não reconcilia pendências de permission/question; essa parte foi confirmada por código, sem probe separado.

O teste não derrubou um socket real: verificou o alvo efetivo do callback de reconnect, cuja ligação foi inspecionada. Uma pendência perdida durante o intervalo pode continuar invisível, embora o stream tenha voltado.

**Correção recomendada:** reconciliar sessões carregadas e interações pendentes após lacuna de eventos, invalidar caches por geração e impedir reads antigos de sobrescrever estado novo. Recuperar apresentação não autoriza repetir trabalho do provider após crash.

### RT5 — P2: PNG/GIF síncrono atrasa o event loop do backend

**Medido com renderer e Chromium reais.** SVG determinístico com textura, quatro frames, 20 fps, dois tamanhos alternados, timer de 10 ms:

| Export | Tempo total | Maior intervalo do timer | Percentil 95 do intervalo |
| --- | ---: | ---: | ---: |
| 128 px, primeiro uso | 2.465 ms | 557 ms | 21,9 ms |
| 1024 px | 2.248 ms | 214 ms | 29,0 ms |
| 128 px, aquecido | 608 ms | 53 ms | 17,2 ms |
| 1024 px, aquecido | 2.024 ms | 140 ms | 38,3 ms |

Intervalo significa tempo entre callbacks de um timer nominal de 10 ms, não atraso adicional a somar a esses valores. O primeiro uso inclui imports e inicialização; não se atribuem os 557 ms inteiramente ao encoder.

Um segundo ensaio com profiler manteve intervalo máximo de 129 ms no export aquecido de 1024 px. As funções com mais amostras próprias incluíram `gifenc.lzwEncode`, `pngjs/filter-parse`, `gifenc.output` e `applyPalette`. Isso sustenta a presença de trabalho de codec na thread, sem atribuir toda a demora a uma função.

Fonte: [renderer](../../packages/core/src/design/renderer.ts), linhas 183–197: decode PNG, quantização e escrita de frame síncronos; yield entre frames. O schema já limita tamanho a 1024, duração a dez segundos e fps a 25. Não são parâmetros ilimitados.

**Correção recomendada:** pipeline de encoding isolado, com fila e memória limitadas, buffers transferíveis, progresso e cancelamento independente. Preservar SVG editável e GIF como export. A TUI hospeda o servidor em Worker separado: esses números medem responsividade do backend, **não latência direta do teclado**.

## Lacunas de produto e arquitetura

**A TUI e o App ainda não oferecem o mesmo contrato de Session.** Core tem Design V2; a TUI usa os agentes legacy, com Build/Plan, e `/design` abre a revisão no browser. Isso não completa a promessa do terceiro modo no CLI. A decisão de Design V2-only está explícita em `specs/design/`: a recomendação é conectar a TUI ao contrato V2, sem recriar Design V1.

**Há duplicação de decisões de lifecycle.** Contagem, falha, conclusão e transição são decididas em pontos diferentes no legacy, Core e cliente. É um julgamento arquitetural de Duplicated Code/Shotgun Surgery, sustentado pelas divergências acima; não uma contagem adicional de defeitos. O cliente deve projetar o estado efetivo e enviar intenções. O runner deve controlar a aceitação de conclusão. O subsistema de processos deve possuir cancelamento e limpeza.

Gates legacy executam shell diretamente, enquanto Core consulta a ação `bash`. Como gates são comandos escritos pelo próprio usuário, isso não constitui por si só um ataque do modelo. É uma diferença de política a resolver para que Plan/Design tenham contrato compreensível e igual entre clientes.

## O que absorver de Codex, Oh My Pi e Hermes

| Referência examinada | Aplicação concreta no Redcode | Ordem |
| --- | --- | --- |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server): `item/completed`, `turn/completed`, steering com `expectedTurnId`, controle separado de comandos | Eventos finais autoritativos; versão esperada nas intervenções; distinguir ferramenta, turno, Goal e processo; cancelar comando sem depender da conclusão do modelo | Primeiro, para SP1/SP2/SP7/RT1/RT4 |
| [Oh My Pi Agent Hub](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/docs/agent-hub.md): atividade, retries, uso, transcripts e intervenção | Mostrar etapa atual, última atividade, motivo de espera, budget e ações de parar/retomar; dar visibilidade a comandos e jobs no Context da TUI | Depois de tornar esses estados confiáveis |
| [Oh My Pi Session operations](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/docs/session-operations-export-share-fork-resume.md): `/fresh` preserva transcript ao renovar transporte/cache do provider | Recuperação específica: reconectar UI, interromper chamada, renovar transporte ou cancelar job; preservar histórico e autorização | Junto da recuperação e reconciliação |
| [Hermes Memory](https://github.com/NousResearch/hermes-agent/blob/5280fe99872a58f1b9d25b00a79d240ecd035f7d/website/docs/user-guide/features/memory.md): memória limitada, snapshot estável na sessão e busca sob demanda | Contexto curto e estável, com histórico recuperável; evitar crescimento de prompt e múltiplos escritores sem coordenação | Depois da confiabilidade e medição |
| [Hermes Skills](https://github.com/NousResearch/hermes-agent/blob/5280fe99872a58f1b9d25b00a79d240ecd035f7d/website/docs/user-guide/features/skills.md): `/learn` e referências progressivas | Aprender procedimentos de execuções verificadas, com origem, escopo e possibilidade de revisão; não converter uma falha silenciosa em receita | Última etapa |

As referências Hermes e OMP estão fixadas nos commits examinados. Um HEAD posterior do Hermes foi observado, mas não usado para atribuir novas capacidades. Codex foi consultado na documentação oficial corrente. Essas referências orientam desenho de controles; não demonstram que os outros produtos sejam isentos dos defeitos encontrados aqui. `/fresh` não resolve thread bloqueada por CPU nem restaura sozinho um terminal.

## Sequência de evolução e critérios de aceite

| Etapa | Entrega | Evidência exigida |
| --- | --- | --- |
| 1. Controle da sessão | Corrigir listeners, reconciliação, eviction e término de processos | Zero callbacks depois do dispose; cache liberado ao excluir; mensagem e aprovação recuperadas após gap; cancelamento termina filho resistente dentro da política configurada |
| 2. Integridade de Goal e modos | Aceite de conclusão no runner, fences de admissão/revisão, modo efetivo autoritativo | Edição irmã e novo steer impedem DONE obsoleto; Plan-only continua Plan na TUI e no próximo prompt; pausa não é revertida por revisão atrasada |
| 3. Fronteiras de Design | Validação de caminhos e leitura transitiva autorizada | Feedback permanece na área designada; bundle não contém arquivo protegido sem autorização; imports autorizados de produto continuam funcionando |
| 4. Um contrato para CLI/App | TUI adota SessionV2, budgets e estados de falha coerentes | Mesmas jornadas Build/Plan/Design nos dois clientes; orçamento editável e instruções válidas; retries/juiz contabilizados mesmo quando parecer é descartado |
| 5. Desempenho verificável | Encoding isolado e benchmark de longa duração | Input-to-paint, event-loop delay, RSS, listeners, filas, startup e cancelamento medidos separadamente; resultados comparáveis antes/depois |
| 6. Qualidade e aprendizagem | Evals reais de Plan, Design, execução e retomada; aprendizado revisável | Sucesso observado, correções humanas, custo total, tempo até preview útil e abandono; aprendizagem baseada no resultado verificado |

As etapas 1–3 são prioridades antes da próxima ampliação de autonomia; segurança de Design pode avançar em paralelo à integridade de Goal. Não é necessário concluir uma migração completa da TUI para corrigir os problemas atuais.

Para a etapa 5, começar com um teste curto determinístico em CI e um soak de duas horas fora do caminho rápido: navegações repetidas, bursts de streaming, outputs grandes dentro dos limites, jobs de GIF, pause/resume e interrupção de conexão. Registrar taxas de evento, tamanhos e ambiente. Como metas iniciais a calibrar, propor input-to-paint p95 abaixo de 50 ms e p99 abaixo de 100 ms no cenário definido; nenhuma tendência de retenção após aquecimento; controle de cancelamento verificável durante carga. Ainda não há baseline da TUI que justifique declarar essas metas atendidas.

## O que não foi demonstrado

- A janela comum da TUI não cresce sem limite: hidratação e append respeitam cem mensagens e o append limpa partes da mensagem expulsa.
- O startup com Session inexistente terminou com código 1 em 7,698 s e mensagem correta. A suspeita de hang nesse caminho não se reproduziu.
- PubSub e RPC merecem avaliação de limites/deadlines, mas não foi demonstrado vazamento ou hang nesses pontos. A fila de eventos limpa após flush; não foi medida a latência de bursts extremos nem de output muito extenso.
- Os 220 testes registrados na implementação anterior não foram rerodados como parte desta auditoria e não cobriam estes interleavings ou a jornada TUI de Plan-only. O benchmark anterior era navegação do App, não longa duração ou input-to-paint do terminal.
- Não houve avaliação paga de qualidade de planejamento/Design nem soak de duas horas nesta execução. Nenhum achado identifica sozinho a causa do incidente original do shell.

## Evidências locais e repetição

Os diretórios de `/tmp` são artefatos locais temporários. Este relatório preserva resultados e cenários mesmo quando forem removidos pelo sistema. Para repetir os probes, copiar a fonte ao caminho de teste original, executar no diretório do pacote e remover apenas essa cópia.

| Evidência | Arquivo / execução |
| --- | --- |
| Goal/admissão/uso | `/tmp/redcode-cli-audit-spec/goal-probe.ts` e `goal-probe.log`; copiar para `packages/core/test/audit-spec-goal-20260907.test.ts`; em Core: `bun test --timeout 15000 test/audit-spec-goal-20260907.test.ts` |
| Ferramentas irmãs | `/tmp/redcode-cli-audit-spec/runner-probe.ts` e `runner-probe.log`; copiar para `packages/core/test/audit-spec-runner-20260907.test.ts`; em Core: `bun test --timeout 15000 test/audit-spec-runner-20260907.test.ts` |
| Legacy retry/falha | `/tmp/redcode-cli-audit-spec/legacy-probe.ts` e `legacy-probe.log`; copiar para `packages/redcode/test/session/audit-spec-legacy-20260907.test.ts`; no pacote: `bun test --timeout 20000 test/session/audit-spec-legacy-20260907.test.ts` |
| Lifecycle/cache/reconexão TUI | `/tmp/redcode-cli-audit-spec/tui-probe.tsx` e `tui-probe.log`; copiar para `packages/tui/test/cli/cmd/tui/audit-spec-tui-20260907.test.tsx`; em TUI: `bun test --timeout 15000 test/cli/cmd/tui/audit-spec-tui-20260907.test.tsx` |
| Fronteiras Design | Fontes e resultados dos probes já concluídos: `/tmp/redcode-cli-audit-standards/probes.test.ts` e `probes.log`; usaram apenas canários artificiais em projeto temporário |
| Cancelamento | `/tmp/redcode-cli-audit-perf/cancel-probe.ts`; log `/tmp/redcode-cli-audit-cancel-final.log`; origem `packages/core/test/process/cli-audit-cancel.probe.ts` |
| GIF | `/tmp/redcode-cli-audit-perf/gif-probe.ts`; log `/tmp/redcode-cli-audit-gif-perf.log`; origem `packages/core/test/cli-audit-gif.perf.ts` |
| Perfil CPU | `/tmp/redcode-cli-audit-perf/gif.cpuprofile`, `profile-summary.json` e `/tmp/redcode-cli-audit-gif-profile.log` |
| Startup | `/tmp/redcode-cli-audit-startup-result.json` e `/tmp/redcode-cli-audit-startup-output.log` |

Os scripts de processo/GIF executam via `bun run --preload ./test/preload.ts <caminho>` em Core. Para GIF, fornecer `PLAYWRIGHT_BROWSERS_PATH=/home/cyber/.cache/ms-playwright` ou o cache equivalente. O perfil usou `--cpu-prof --cpu-prof-dir=/tmp/redcode-cli-audit-perf --cpu-prof-name=gif.cpuprofile`. Não executar testes na raiz.

Contagem por eixo: **Standards: 2; Spec: 7; runtime/desempenho: 5.** O pior problema de integridade é aceitar DONE enquanto os efeitos da mesma resposta ainda podem modificar a evidência verificada.
