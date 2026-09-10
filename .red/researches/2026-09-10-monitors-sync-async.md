# Monitores, execução sync/async e retomada de tarefas

Data: 2026-09-10.
Pergunta: como Hermes, Oh My Pi, Pi, OpenClaw e DeepSeek Harness acompanham trabalho demorado ou externo e retomam o agente; como oferecer execução síncrona e assíncrona no Redcode.
Escopo: leitura estática de documentação e código oficiais. Não foram executados os runtimes externos, benchmarks de LLM ou testes das implementações pesquisadas. As recomendações abaixo não estão implementadas no Redcode.

## Resumo executivo

Os projetos oferecem partes complementares da experiência. Hermes tem notificações por término ou sinal de saída e uma tarefa que pode ficar aguardando sem novas chamadas ao modelo. Oh My Pi oferece transição automática de foreground para background e entrega à sessão proprietária. OpenClaw combina processos, eventos que acordam sessões, webhooks e registros duráveis de tarefas. Pi deliberadamente não inclui background bash, mas expõe os pontos de extensão para construir essa experiência. DeepSeek oferece um contrato genérico entre produtores de trabalho, registro de jobs e ferramentas de acompanhamento. [H1][H2][H3][O1][O2][O3][C1][C2][P1][P2][D1][D2]

**A recomendação é separar execução, observação e continuação.** O tempo de uma operação não determina seu protocolo. Um comando pode ser síncrono e demorado; uma API assíncrona pode retornar imediatamente, embora o trabalho ainda esteja pendente. Background determina quanto tempo a ferramenta prende o turno do agente, não o momento em que o objetivo real foi atingido.

## Fontes oficiais e versões

| Projeto | Repositório e commit consultado |
| --- | --- |
| Hermes | `NousResearch/hermes-agent` — `67764dc0863349a384c16425e73ee8571f3a94b7` |
| Oh My Pi | `can1357/oh-my-pi` — `d884057f09c50ad096ccd4ca16cec79602e9879c` |
| Pi | `earendil-works/pi` — `4bd3f48df0b14c82e8df2640645e94f82f125f44` |
| OpenClaw | `openclaw/openclaw` — `e6031c1f433895f44c60a4fd1befd9e37344bf6b` |
| DeepSeek Harness | `deepseek-ai/deepseek-harness` — `aa8262ec091698bae9a6b04773a6b5b06ad4aef2` |
| Redcode | `reddb-io/redcode` — `a564f75c9c7c00ecf0c1db45d62653200e455912` (`v0.25.2`) |

O endereço solicitado implicitamente para Pi, `badlogic/pi-mono`, redirecionou para `earendil-works/pi` na consulta ao GitHub. Os links deste relatório fixam os commits; defaults descrevem esses snapshots, não contratos eternos dos produtos.

## Comparação

| Projeto | Comando síncrono longo | Observação/retomada | Limite relevante |
| --- | --- | --- | --- |
| Hermes | Foreground ou `terminal(background=true)`; há caminhos de promoção para background | `notify=true` no término; `notify=[...]` para sinal de saída; barreira de espera do goal | Recuperação de processo é parcial; notificações de saída têm limites contra repetição |
| Oh My Pi | `async: true` ou promoção automática, normalmente após 60 s | Registro de jobs, entrega automática por proprietário, resultado em follow-up | Manager em memória; caminhos PTY/client bridge têm comportamento próprio |
| Pi | Bash foreground; README recomenda tmux para background | Extensão recebe evento e chama `sendMessage(..., {triggerTurn:true})` | Não entrega um monitor pronto no núcleo |
| OpenClaw | `background:true` ou `yieldMs`, default 10 s | `process`, evento de conclusão, wake, webhooks | Alguns workers não acordam o Gateway automaticamente; handle de processo não sobrevive a restart |
| DeepSeek | `run_in_background:true` explícito; foreground usa executor diretamente | `ctx.jobs`; `job_output`, `job_list`, `job_kill`; notice/injeção/wake | Jobs locais não duráveis; background bash não recebe timeout nesse caminho |

Fontes da tabela: [H1][H3][H5][O1][O2][O5][P1][P2][C1][C2][D2][D3][D5]. “Monitor” é usado neste relatório como conceito do produto. Não encontrei um monitor genérico de predicados externos pronto nos módulos de jobs do DeepSeek examinados.

## Sync e async: quatro situações que precisamos distinguir

Os exemplos desta seção são conceituais, não ferramentas já existentes no Redcode.

| Situação | O que comprova o resultado | O que o harness acompanha |
| --- | --- | --- |
| `npm test`, rápido | Processo encerrou e testes passaram | Saída e término na própria chamada |
| `npm test`, demora dez minutos | A mesma condição | Mesmo processo em background; nenhum segundo lançamento |
| `customcli deploy --async`, retorna `job=123` | Job remoto 123 atingiu estado terminal esperado | Status remoto por consulta ou evento, mesmo depois de o CLI sair |
| Servidor imprime `READY` e continua vivo | Sinal de prontidão, eventualmente validado por health check | Condição de saída/saúde; processo continua sob controle separado |

Um `curl` com exit code 0 prova que a transferência funcionou, não que o corpo contém `status=completed`. Um HTTP 202 prova admissão. Um `ping` comprova uma propriedade da conectividade, não a saúde inteira do serviço. A condição de sucesso precisa estar declarada no nível correto.

Há pelo menos três relógios diferentes: **espera da chamada** (quando devolver um handle), **limite de execução** (quando interromper o processo, se controlável) e **prazo de observação** (quando encerrar a espera por um evento externo). O OpenClaw explicita essa distinção entre `yieldMs`, timeout do processo e timeout do poll; o DeepSeek explicita que o timeout de `job_output(wait:true)` deixa o job vivo. [C1][D2]

## Hermes: sinais de saída e espera vinculada ao objetivo

O schema atual anuncia `terminal(command, background, timeout, workdir, pty, notify)`. `notify=true` pede aviso de término; um array em `notify` observa substrings nas linhas de saída. `notify_on_complete` e `watch_patterns` permanecem aliases aceitos, mas a interface anunciada usa `notify`. São opções para background. O default foreground retorna quando termina, com timeout padrão de 180 s; uma solicitação acima do teto foreground pode ser promovida para um processo acompanhado. O resultado instrui a não executar o comando novamente. [H1]

O registro mantém buffers limitados, identidade do processo e da sessão, saída e fila de eventos. A observação de padrões é determinística; o código procura correspondências nas linhas recebidas. Há cooldown de 15 s por sessão, desativação após repetição excessiva, teto de oito entregas por vida do monitor de saída e proteção global. Não é um mecanismo de regex arbitrária nem garantia de uma única notificação por padrão: trata-se de sinalização limitada, que pode cair para aviso só no término. [H2]

O ponto mais alinhado ao pedido é o goal aguardar uma condição. O judge pode escolher `wait_on_session`, `wait_on_pid` ou `wait_for_seconds`. Depois de criada a barreira, a espera não exige novas chamadas ao judge nem ao agente. `wait_on_session` libera no término ou no sinal configurado; `wait_on_pid` libera no término. A barreira é persistida no estado do goal, com teto documentado de 30 minutos para espera em PID/sessão. [H7] Desconhecer um processo libera a barreira para reavaliação: isso não deve ser interpretado como comprovação de sucesso. [H3]

A entrega do CLI conserva identidade e resolve sessões anteriores à compressão para sua continuação. Agrupa conclusões e verifica novamente se o resultado já foi consumido, reduzindo mensagens redundantes. A recuperação do Gateway persiste metadados e verifica PID mais identidade de início antes de adotar um processo sobrevivente. Processos recuperados ficam detached: podem ter status e cancelamento, mas não recuperam o stream antigo de saída. Portanto, não equivale a execução durável integral. [H4][H5]

Para condições externas periódicas, existe cron `no_agent=True`: executa um script sem LLM; saída vazia fica silenciosa, saída não vazia é entregue ao destino configurado. Isso é observação barata, mas a entrega de uma mensagem por cron, isoladamente, não comprova retomada da tarefa original. [H6]

## Oh My Pi: promover a execução sem lançar novamente

`bash` aceita `async:true`. A configuração de auto-background está ligada por default, com limiar de 60.000 ms. [O6] No caminho elegível, o comando já nasce como job gerenciado e a ferramenta disputa sua conclusão contra o limiar, cancelamento e chegada de uma mensagem de steering. Se acabar logo, devolve o resultado inline; se demorar ou chegar uma mensagem, libera o turno e conserva o mesmo job. O limiar de espera é limitado pelo timeout da chamada menos uma margem; background não estende a duração autorizada. PTY e terminal fornecido pelo client bridge seguem caminhos distintos. [O1][O2]

Durante a espera inicial, a entrega automática fica suprimida para evitar resultado inline mais notificação duplicada. Quando a ferramenta passa para background, reabilita a entrega. O manager registra jobs `bash`, `task` e `eval`, oferece cancelamento e acompanha entregas com retry. A sessão registra seu próprio destino; a entrega usa uma geração que muda em transições como `/new`, evitando inserir resultado antigo no transcript substituído. Resultados longos são encaminhados por referência a artefato com preview. [O2][O3][O4]

Há polling adaptativo opcional com intervalos de 5, 10, 30, 60 e 300 segundos. Ele reduz rodadas inúteis quando o agente insiste em consultar. Ainda prefiro copiar a entrega automática e usar poll para inspeção ou espera realmente necessária. O manager usa mapas e filas em memória: essa arquitetura não demonstra recuperação automática após queda do processo. [O5]

## Pi: mecanismo de extensão, sem background bash nativo

O README declara explicitamente “No background bash. Use tmux.” Seu bash espera o processo e aceita timeout; a existência de uma Promise no código não significa que o agente recebeu um handle de background. [P1][P3]

O SDK de extensões oferece `sendMessage` com `deliverAs: steer | followUp | nextTurn` e `triggerTurn:true`. Uma extensão pode observar arquivo, socket ou serviço e entregar um evento: `steer` entra entre turnos do provider, `followUp` após o trabalho corrente, `nextTurn` espera nova entrada do usuário. Se o agente está idle, `triggerTurn` pode iniciar uma resposta nos dois primeiros modos. O exemplo oficial `file-trigger.ts` demonstra um arquivo externo acordando o agente. É um exemplo mínimo, não um monitor com durabilidade, confirmação de entrega e cancelamento completos. [P2]

O que aproveitar é o vocabulário de entrega e a origem explícita da mensagem. O Redcode precisa oferecer a experiência integrada pedida pelo usuário; remeter tudo a extensões/tmux não atende essa expectativa.

## OpenClaw: processo, evento e registro da tarefa

`exec` espera até `yieldMs` (default 10.000 ms) e então devolve `status:running` e `sessionId`, ou inicia imediatamente com `background:true`. O timeout do processo continua valendo. `process` permite listar, consultar, ler logs, enviar entrada e parar. [C1]

Quando um processo background encerra, o runtime pode enfileirar um evento e solicitar um heartbeat direcionado à sessão. Esse wake é orientado a evento, distinto da cadência recorrente de heartbeat. O código evita avisar se o término já foi observado por poll. Há uma ressalva importante: sucesso sem saída não dispara aviso por default (`notifyOnExitEmptySuccess:false`). Outra: a documentação informa que conclusão em certos workers ainda não acorda automaticamente o Gateway. [C1][C3]

Os processos têm projeção em um registro durável de tarefas, com `runId`, proprietário, timestamps e estado terminal, finalizado antes do wake. Isso melhora visibilidade e reconciliação, mas os handles de processo continuam em memória. Registrar a tarefa em disco não faz o processo sobreviver ao host ou worker. [C1][C4]

Para o caso verdadeiramente externo, webhooks são a referência mais direta: `/hooks/wake` enfileira um evento e pode pedir wake imediato; `/hooks/agent` admite uma execução, com modos de sessão e idempotência. A documentação distingue resposta de admissão de conclusão e oferece `waitForCompletion:true` para o chamador que deseja aguardar o resultado terminal. Esse é um exemplo explícito de interface sync/async para a mesma operação. [C2]

## DeepSeek Harness: produtor, registro e controlador separados

A família tem três partes: `dsh-jobs` define o contrato; `dsh-jobs-local` implementa o registro em memória; `dsh-tool-jobs` oferece `job_output`, `job_list`, `job_kill` e entrega ao modelo. Bash e subagentes são produtores. O controlador tem que estar disponível antes de iniciar trabalho, evitando criar um job sem como acompanhá-lo. O limite default é de dez jobs ativos ou parando por proprietário. [D1][D2][D3]

O produtor oferece `run()` e devolve hooks `done`, `cancel` e, opcionalmente, `readOutput`. `done` representa a liberação dos recursos do produtor; o registro controla identidade, ownership e estados `running → stopping → completed/killed/failed`. Solicitar cancelamento não libera capacidade nem significa que o trabalho já parou. A primeira conclusão vence, o estado é atualizado antes da notificação e leituras/esperas que já entregaram o resultado suprimem avisos redundantes. [D1][D3][D6]

Para sync, o bash usa o executor foreground. Com `run_in_background:true`, registra o processo em `ctx.jobs` e retorna o ID. Nesse caminho, **não aplica timeout ao processo**, diferentemente de OMP/OpenClaw. `job_output(wait:true)` tem timeout de espera separado, default 30 s e cap 600 s; expirar essa espera devolve o estado atual e deixa o job vivo. [D2][D5]

Na conclusão, `tool-jobs` entrega uma notice curta com ID e instrução para ler o resultado. Se o proprietário está ocupado, usa `owner.inject`; se está idle e a política permite, usa `owner.followup`. `completionDelivery` pode ser `quiet` ou `wakeup`; default `wakeup`, com até três wakes consecutivos por proprietário antes de degradar para injeção. Entrada realmente humana reseta esse contador; uma notificação do próprio plugin não reseta. Isso limita loops que se acordam indefinidamente. [D2]

Há uma distinção que precisamos preservar: bash com exit code não zero ainda pode ter job `completed`, com o código de saída em `detail`. `completed` significa encerrado, não objetivo aprovado. O adapter também registra limitações de classificação de falhas de infraestrutura. [D4]

Nos módulos pesquisados, não encontrei uma API pronta de “consulte esta URL até este campo assumir tal valor”. O contrato permite um produtor desse tipo, mas implementá-lo continua sendo trabalho adicional. Os jobs locais morrem com o harness e a identidade do owner é um agente vivo; não basta serializar o objeto para obter retomada durável. [D1][D3]

## O que existe no Redcode e o que falta

Na `v0.25.2`, `BackgroundJob` já implementa registro em memória, `start`, `extend`, `wait`, `promote` e `cancel`. O próprio código declara que não oferece persistência/recovery. O `task` legado registra trabalho de subagente e injeta sua conclusão no pai. Já o bash Core examinado aguarda `AppProcess.run` e retorna timeout; não oferece ao modelo o mesmo fluxo automático de promoção e observação. Portanto, temos componentes reaproveitáveis, mas não a experiência integrada de monitores proposta aqui. [R1][R2][R3]

A arquitetura V2 exige preservar admissão durável de entradas, wake consultivo por Session ID e execução serializada. O resultado do monitor deve ser admitido com identidade própria, distinguível de entrada humana, e promovido em fronteira segura; ele não deve iniciar um segundo loop concorrente nem chamar o loop legado. Recovery de execução após queda continua exigindo desenho explícito. [R4]

## Recomendação para o Redcode

Proposta de implementação futura, derivada da comparação:

1. **Execução única, entrega configurável.** `foreground`, `background` e `auto` mudam a espera da ferramenta, conservando o mesmo ID/processo. Terminar rapidamente entrega inline; promover para background não repete efeitos.
2. **Monitor separado do trabalho.** Aceitar observação de término de processo, sinal de saída, consulta periódica com predicado estruturado e evento externo. O monitor pode apenas observar uma operação que já existe; não precisa criá-la.
3. **Persistir a dependência da tarefa.** Guardar Session ID, identidade da tarefa, operação externa/processo, condição, prazo, evidência mais recente e próximo passo. A tarefa fica `waiting` quando não há trabalho independente, sem chamadas periódicas ao modelo.
4. **Entregar resultado como evento estruturado.** Gravar evidência e referência para logs; admitir um evento idempotente e pedir wake ao runner existente. Entregar em fronteira segura, agrupando resultados. Aguardar não é conclusão; receber um sinal exige revalidar o próximo passo contra instruções atuais.
5. **Separar cancelamentos.** Parar de observar, cancelar a retomada e interromper o trabalho externo são ações distintas. Para API sem cancelamento, registrar essa limitação; nunca declarar que o trabalho parou só porque o monitor foi cancelado.
6. **Expor estado no TUI.** Lista de acompanhamentos com tarefa, condição, último resultado, tempo e prazo; ações de inspecionar/cancelar. Novos resultados pertencem à sessão original, mesmo se outra conversa estiver aberta.

Não exigir uma configuração técnica do usuário a cada uso. O agente pode interpretar “acompanhe este deploy e teste quando ficar pronto” e montar o contrato; a UI torna esse contrato observável. Para decisões semânticas que realmente precisam de LLM, distinguir explicitamente essa avaliação do polling determinístico e contabilizar seu custo.

### Ordem sugerida e verificações de aceitação

| Etapa | Entrega | Cenários que devem ser comprovados |
| --- | --- | --- |
| 1 | Job de comando + retorno inline/background/auto | Comando rápido; promoção sem segundo spawn; prazo de espera sem matar processo; cancelamento confirmado; resultado entregue uma vez |
| 2 | Monitor de operação externa + tarefa aguardando | HTTP 202 não conclui deploy; consulta `pending → done`; erro terminal; timeout distinto de falha remota; zero chamadas de LLM enquanto nada mudou |
| 3 | Retomada e persistência | Compactação durante espera; resultado enquanto outro turno roda; troca de sessão; cancelamento pelo usuário; reinício com reobservação do ID externo, sem reenviar o deploy |
| 4 | Eventos/webhooks e UI completa | Evento duplicado/reordenado; entrega agrupada; logs recuperáveis; política de wake; usuário pode inspecionar e parar acompanhamento |

A preservação do contrato e da identidade da tarefa é necessária desde a primeira etapa; a ativação de reobservação após restart exige a etapa específica de recovery. Para processos locais perdidos, o estado correto pode ser `unknown/lost`, seguido de reconciliação. Ausência de processo não prova que a operação externa falhou ou terminou bem.

## Questões ainda abertas

- Qual processo permanece vivo quando o usuário fecha o TUI? Monitores só sobrevivem se houver runtime residente ou scheduler que os recupere.
- Qual política diferencia um cancelamento temporário do turno de uma proibição de retomar aquela tarefa?
- Qual vocabulário de evento interno V2 preserva origem de monitor sem fingir uma nova solicitação humana e sem resetar automaticamente todos os limites de execução?
- Quais adapters externos entram primeiro? CI e disponibilidade npm reproduzem o caso desta sessão, com sucesso e falha verificáveis.

## Links diretos para as evidências

- [H1: Hermes — schema e execução terminal][H1]
- [H2: Hermes — registro e sinais de saída][H2]
- [H3: Hermes — barreiras de espera do goal][H3]
- [H4: Hermes — entrega de notificações ao CLI][H4]
- [H5: Hermes — checkpoint e recuperação de processos][H5]
- [H6: Hermes — cron sem LLM][H6]
- [O1: OMP — limiar e disputa de espera][O1]
- [O2: OMP — execução bash e promoção][O2]
- [O3: OMP — entrega por proprietário e geração da sessão][O3]
- [O4: OMP — envelope estruturado do resultado][O4]
- [O5: OMP — manager, retries e espera adaptativa][O5]
- [P1: Pi — filosofia do núcleo][P1]
- [P2: Pi — API de mensagens de extensões][P2]
- [P3: Pi — execução bash][P3]
- [C1: OpenClaw — execução background e limites][C1]
- [C2: OpenClaw — webhooks, admissão e conclusão][C2]
- [C3: OpenClaw — wake por conclusão][C3]
- [C4: OpenClaw — projeção no registro de tarefas][C4]
- [D1: DeepSeek — contrato de produtor e job][D1]
- [D2: DeepSeek — controles e política de wake][D2]
- [D3: DeepSeek — implementação local e ciclo de vida][D3]
- [D4: DeepSeek — adapter bash e significado de completed][D4]
- [R1: Redcode — BackgroundJob][R1]
- [R2: Redcode — resultado de subagente background][R2]
- [R3: Redcode — bash Core][R3]
- [R4: Redcode — contrato arquitetural V2][R4]

[H1]: https://github.com/NousResearch/hermes-agent/blob/67764dc0863349a384c16425e73ee8571f3a94b7/tools/terminal_tool.py#L1257-L1348
[H2]: https://github.com/NousResearch/hermes-agent/blob/67764dc0863349a384c16425e73ee8571f3a94b7/tools/process_registry.py#L40-L68
[H3]: https://github.com/NousResearch/hermes-agent/blob/67764dc0863349a384c16425e73ee8571f3a94b7/hermes_cli/goals.py#L1326-L1427
[H4]: https://github.com/NousResearch/hermes-agent/blob/67764dc0863349a384c16425e73ee8571f3a94b7/hermes_cli/cli_process_notifications.py
[H5]: https://github.com/NousResearch/hermes-agent/blob/67764dc0863349a384c16425e73ee8571f3a94b7/tools/process_registry_checkpoint.py
[H6]: https://github.com/NousResearch/hermes-agent/blob/67764dc0863349a384c16425e73ee8571f3a94b7/website/docs/guides/cron-script-only.md
[O1]: https://github.com/can1357/oh-my-pi/blob/d884057f09c50ad096ccd4ca16cec79602e9879c/packages/coding-agent/src/async/auto-background.ts
[O2]: https://github.com/can1357/oh-my-pi/blob/d884057f09c50ad096ccd4ca16cec79602e9879c/packages/coding-agent/src/tools/bash.ts#L1145-L1216
[O3]: https://github.com/can1357/oh-my-pi/blob/d884057f09c50ad096ccd4ca16cec79602e9879c/packages/coding-agent/src/session/agent-session.ts
[O4]: https://github.com/can1357/oh-my-pi/blob/d884057f09c50ad096ccd4ca16cec79602e9879c/packages/coding-agent/src/session/async-job-delivery.ts
[O5]: https://github.com/can1357/oh-my-pi/blob/d884057f09c50ad096ccd4ca16cec79602e9879c/packages/coding-agent/src/async/job-manager.ts
[P1]: https://github.com/earendil-works/pi/blob/4bd3f48df0b14c82e8df2640645e94f82f125f44/packages/coding-agent/README.md#L495-L511
[P2]: https://github.com/earendil-works/pi/blob/4bd3f48df0b14c82e8df2640645e94f82f125f44/packages/coding-agent/docs/extensions.md#L1422-L1445
[P3]: https://github.com/earendil-works/pi/blob/4bd3f48df0b14c82e8df2640645e94f82f125f44/packages/coding-agent/src/core/tools/bash.ts
[C1]: https://github.com/openclaw/openclaw/blob/e6031c1f433895f44c60a4fd1befd9e37344bf6b/docs/gateway/background-process.md
[C2]: https://github.com/openclaw/openclaw/blob/e6031c1f433895f44c60a4fd1befd9e37344bf6b/docs/automation/cron-jobs/webhooks.md
[C3]: https://github.com/openclaw/openclaw/blob/e6031c1f433895f44c60a4fd1befd9e37344bf6b/src/agents/bash-tools.exec-runtime.ts#L341-L408
[C4]: https://github.com/openclaw/openclaw/blob/e6031c1f433895f44c60a4fd1befd9e37344bf6b/src/agents/bash-tools.exec-task-tracking.ts
[D1]: https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/jobs/jobs/src/types.ts
[D2]: https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/jobs/tool-jobs/src/index.ts
[D3]: https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/jobs/jobs-local/README.md
[D4]: https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/shell/tool-bash/src/background.ts
[R1]: https://github.com/reddb-io/redcode/blob/a564f75c9c7c00ecf0c1db45d62653200e455912/packages/core/src/background-job.ts
[R2]: https://github.com/reddb-io/redcode/blob/a564f75c9c7c00ecf0c1db45d62653200e455912/packages/redcode/src/tool/task.ts#L239-L278
[R3]: https://github.com/reddb-io/redcode/blob/a564f75c9c7c00ecf0c1db45d62653200e455912/packages/core/src/tool/bash.ts#L165-L203
[R4]: https://github.com/reddb-io/redcode/blob/a564f75c9c7c00ecf0c1db45d62653200e455912/AGENTS.md

[O6]: https://github.com/can1357/oh-my-pi/blob/d884057f09c50ad096ccd4ca16cec79602e9879c/packages/coding-agent/src/config/settings-schema.ts#L3980-L3988
[H7]: https://github.com/NousResearch/hermes-agent/blob/67764dc0863349a384c16425e73ee8571f3a94b7/website/docs/user-guide/features/goals.md#L153-L176
[D5]: https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/shell/tool-bash/README.md
[D6]: https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/jobs/jobs-local/src/index.ts#L410-L442
