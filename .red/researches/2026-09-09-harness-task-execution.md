# Da intenção à entrega: Oh My Pi, Hermes, DeepSeek Harness e Redcode

Data: 2026-09-09

Pedido: estudar novamente os três harnesses, especialmente como direcionam a criação e a finalização de tarefas, e identificar por que o Redcode parece planejar melhor do que executar.

Escopo: pesquisa de código e documentação dos repositórios oficiais, comparada à `main` publicada do Redcode. Recomendações de produto e implementação; nenhuma alteração de runtime, PR, merge ou release faz parte desta análise.

## Síntese

O problema mais concreto do Redcode não é ausência de ferramentas de planejamento ou de um loop. Já existem todos persistidos, continuação para itens pendentes, planos aprovados por revisão e verificação de Goal. A fragilidade é que a cadeia pedido → tarefas → trabalho executado → evidências → conclusão ainda depende demais da disciplina do modelo. Os contratos desses componentes não garantem cobertura do pedido nem preservação dos itens pendentes. [R1–R8]

Os três projetos oferecem referências complementares:

- **Oh My Pi:** ajuda o modelo a enumerar o pedido inteiro, mantém uma próxima tarefa acionável, atualiza progresso durante a execução e conecta aprovação de plano a todos. Algumas intervenções são opcionais; não são todas o comportamento padrão. [O1–O5]
- **Hermes:** distingue a lista da conversa de tarefas duráveis de um quadro com dependências, ownership, tentativas e revisão. Sair do processo não significa finalizar o trabalho. Seu registro de verificação é útil, mas a cobrança de verificação está desligada por padrão no commit examinado. [H1–H6]
- **DeepSeek Harness:** separa estado durável, ferramentas e agendamento da continuação; associa cada rodada à revisão do objetivo e à origem autorizada do pedido. Não oferece certificação independente de conclusão nesse driver. [D1–D5]

**Recomendação:** fortalecer o contrato de execução que existe, começando pela experiência do TUI. Não criar mais um modo, comando obrigatório ou plataforma de agentes antes de fechar o caminho básico de uma tarefa.

## Fontes e versões examinadas

| Projeto oficial                                                                 | Commit lido                                | Papel nesta pesquisa                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)                         | `2e6b5b79a0c5b190797aace99f41fab6ae42e6c5` | Criação, acompanhamento, retomada e handoff de tarefas |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)       | `f6ddd89692dff1f900983a16208f39a1485a14eb` | Todo, Kanban, estado terminal e evidências             |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | `b2e3b2a0125854567a4a5fcba75782e42fe84901` | Todo, Goal, continuação e detecção de repetição        |
| [reddb-io/redcode](https://github.com/reddb-io/redcode)                         | `4f5cad15d92d1010a13c2a4603748ca4b9122832` | `origin/main`, também revisão publicada em v0.25.0     |

Os três repositórios externos foram clonados e seus SHAs conferidos. O Redcode foi lido em worktree isolado `/tmp/redcode-harness-execution`, branch `harness-execution`. As alterações não commitadas do checkout original não foram tratadas como funcionalidades publicadas nem modificadas.

O estudo de [2026-09-07](2026-09-07-goal-modes-comparison.md) serviu de ponto de partida, mas suas lacunas foram reavaliadas. Plan e Goal V2 já estão na referência atual, o legado já entrega resultados de ferramentas ao juiz, e planos já são lidos e identificados por hash. Repetir as críticas antigas sem essas correções seria incorreto. [R5–R8]

Método: inspeção estática de implementação, configurações, instruções e testes existentes. Não foram executados modelos, benchmarks comparativos ou suites de runtime. Os mecanismos observados sustentam oportunidades; não demonstram que um concorrente entrega mais tarefas em condições equivalentes.

## 1. Oh My Pi: acompanhar a execução desde o começo

### Criação e cobertura

A descrição de `todo` pede lista para três ou mais passos, pedidos explicitamente enumerados e instruções novas no meio do trabalho. Para pedidos com N itens, exige enumerar todos, sem comprimir itens distintos em um genérico “implementar melhorias”. Isso é instrução ao modelo, não um verificador semântico de cobertura. [O1]

`todo.eager` possui três configurações: `default` deixa o modelo decidir; `preferred` injeta sugestão; `always` pode forçar a primeira chamada com `tool_choice`, quando o modelo suporta. O prelude pede cobertura de investigação, implementação e verificação, e continuidade no mesmo turno após criar a lista. [O2, O3]

**Limite que não devemos copiar:** o disparo eager depende de heurísticas, incluindo ignorar prompts terminados em `?` ou `!`. “Consegue corrigir esses três bugs?” é um pedido de ação; pontuação não é um classificador adequado para o Redcode. [O2]

### Próxima tarefa e progresso

A ferramenta suporta operações `init`, `append`, `start`, `done`, `block`, `unblock`, `drop`, `rm` e `view`, com fases. Após mutações bem-sucedidas, normaliza a lista para manter uma tarefa ativa e promove a primeira pendente quando necessário. Bloqueadas permanecem registradas e não são promovidas automaticamente. As identidades são os textos das tarefas; renomear é uma fragilidade a evitar ao adaptar o desenho. [O1, O4]

O tracker conta ferramentas potencialmente mutantes (`bash`, `eval`, `edit`, `write`, `ast_edit`), não alterações comprovadas no filesystem. Após 12 resultados bem-sucedidos sem atualização de todo, pode emitir um lembrete intermediário; no máximo dois por ciclo. Isso ajuda a impedir uma lista visualmente abandonada enquanto o modelo trabalha. Não comprova progresso real. [O2]

### Finalização e handoff

Ao parar com tarefas pendentes ou em andamento, agenda continuação. O padrão permite três lembretes. Exclui tarefas bloqueadas, evita insistir enquanto há resposta humana pendente ou trabalho assíncrono que vai acordar o agente, e guarda contra relembrar sem nenhuma ação após o lembrete anterior. A detecção de pergunta ao usuário contém heurísticas textuais; no Redcode é preferível usar a identidade de uma pergunta realmente pendente. [O2, O3]

O prompt de plano aprovado traz o conteúdo registrado e exige criar todos antes da execução, atualizar ao concluir passos e continuar até terminar. É uma ponte operacional mais explícita do que simplesmente trocar para Build. [O5]

Há também detecção de parada inesperada: `mechanical` é o padrão; a classificação semântica de uma resposta que promete agir e para requer `smart`. Não atribuir esse comportamento semântico a toda instalação padrão. [O3, O6]

**O que aproveitar:** cobertura integral de pedidos enumerados, próxima tarefa calculada, bloqueio que preserva trabalho, handoff com criação de tarefas e lembretes esparsos durante a execução. Não copiar regras absolutas de esforço ilimitado nem tratar `done` como prova de qualidade: os mecanismos de todo examinados aceitam a declaração do modelo. [O1–O6]

## 2. Hermes: finalizar exige uma transição real

### Duas escalas diferentes

`todo_list` serve ao trabalho dentro da conversa. Possui IDs, relação `parent`, atualização por merge ou substituição e revisão monotônica. A descrição exige uma entrada para cada instância em pedidos “todos os N itens” e conclusão após verificação. O store é local ao agente e pode ser reidratado do histórico; não deve ser confundido com o banco do Kanban. [H1, H2]

O Kanban é outra escala: tarefas persistidas, responsáveis, dependências, tentativas e despacho. O worker recebe uma tarefa, consulta `kanban_show`, trabalha no workspace e encerra com uma transição explícita. O dispatcher só promove dependentes quando os pais estão concluídos. Esse é um recurso do fluxo Kanban, não uma propriedade automática de qualquer chat Hermes. [H3, H4]

### Conclusão, revisão e falhas

As instruções distinguem duas topologias: se existe um filho de revisão/QA/release dependente, concluir a implementação libera esse filho; se a revisão pertence ao mesmo cartão, `kanban_request_review` muda sua fase. Misturar as duas deixa a fila presa ou duplica revisão. O handoff registra resumo e metadata na própria transição, com campos próprios para artefatos. [H3]

Um worker que sai com código zero e deixa o cartão em `running` é classificado pelo dispatcher como violação de protocolo. Há lembrete terminal limitado para workers que param sem chamar uma ferramenta terminal. **A fonte de verdade é o estado do cartão, não o texto “feito” nem o exit code.** [H4]

Limites: o lembrete em `kanban_stop.py` inspeciona chamadas no histórico, não prova o sucesso dessas chamadas. O dispatcher é a segunda camada. A conclusão possui verificações de referências declaradas e preservação de artefatos; isso não prova, por si só, que o produto atende ao pedido. O gate auxiliar de Goal em `kanban_complete` também é condicional à disponibilidade do juiz. [H4, H6]

### Evidência após editar

`verification_evidence.py` registra comando, diretório, status, saída resumida, tipo e escopo da verificação, junto às alterações. Distingue verificações focadas de uma suite completa. `verification_stop.py` pode pedir nova verificação quando o modelo tenta encerrar após editar sem evidência atual, com no máximo dois lembretes. Arquivos exclusivamente de prosa não disparam essa cobrança. [H5]

**Configuração atual:** `agent.verify_on_stop` é opt-in; desligado por padrão. O registro de evidências também fica inativo quando esse gate está desligado. É uma capacidade a estudar, não uma garantia do comportamento padrão. [H5]

**O que aproveitar:** estados terminais explícitos, handoff durável, separação entre revisão e bloqueio externo, resultado de verificação com origem e escopo. Adiar um dispatcher completo: a experiência de uma sessão precisa melhorar antes de multiplicar workers.

## 3. DeepSeek Harness: separar estado, autorização e continuação

### Todo estrito, ainda declarativo

`todo_write` substitui a lista inteira, mas valida conteúdo não vazio, unicidade, enum de estados e, conforme configuração, o máximo de uma tarefa em andamento. Os snapshots são eventos `todo/write` pertencentes à sessão do agente. Isso evita entradas incoerentes, embora ainda permita reduzir a lista sem prova de conclusão. [D1]

Há uma diferença entre durabilidade e apresentação: a projeção de todos examinada fica visível após `turn/end`, mas é limpa em um novo `turn/start`. O histórico durável continua existindo. Não assumir que essa projeção, copiada literalmente, seja um backlog permanente entre pedidos. [D1]

### Objetivo sem exigir vocabulário especial

As ferramentas `get_goal`, `create_goal` e `update_goal` permitem inferir um objetivo duradouro de um pedido humano direto; o usuário não precisa dizer “crie um goal”. O runtime exige origem humana em um turno do agente raiz para criar/editar/retomar. Concluir/bloquear também é permitido numa rodada autônoma identificada do mesmo Goal. Cada atualização utiliza ID e revisão exatos. [D2]

A autorização de origem é verificável; a interpretação semântica do pedido continua sendo julgamento do modelo. Ao adaptar isso, consulta ou estudo precisa terminar em resposta ou relatório; não pode virar autorização para implementar, publicar ou operar continuamente. [D2]

### Continuação durável e limitada

O driver separado reserva a próxima rodada, aguarda checkpoint, confere revisão e só contabiliza a rodada quando a mensagem correspondente entra no histórico. Trabalho humano concorrente tem prioridade. Conclusão, pausa, cancelamento e esgotamento interrompem a continuação; o limite gera motivo explícito `round-limit`. Após retomar sessão ou fork, é preciso autorização humana para rearmar, em vez de reexecutar efeitos automaticamente. [D3]

O prompt de continuação exige consultar workspace, resultados e estado durável atuais, em vez de acreditar na narrativa anterior. O driver declara expressamente que **não há avaliador independente** de conclusão. O requisito de bloqueio após três rodadas impõe uma contagem mínima; não comprova que o obstáculo foi semanticamente igual nas três. [D2, D3]

### Não confundir insistência com execução

`repeat-tool-reminder` compara nome e argumentos canonizados e emite avisos nos limiares padrão 3, 5 e 8. Ferramentas excluídas não reiniciam a sequência; inserir bookkeeping entre chamadas repetidas não mascara a repetição. É consultivo, não bloqueia chamadas, e não detecta ausência de progresso sem repetição exata. [D4]

**O que aproveitar:** Goal inferido de pedido acionável, revisão e origem explícitas, continuação em pontos seguros, motivo durável de parada e contexto compacto. Preservar a admissão durável e o ownership atuais do Redcode; não transplantar outro event loop nem outra camada geral de serviços. [R10]

## 4. Diagnóstico do Redcode atual

| Achado confirmado na leitura                                                                                                                                             | Efeito possível na execução                                                                                     | Prioridade     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------- |
| `status` e `priority` são strings livres; `active()` reconhece só `pending` e `in_progress`. O teste existente inclui `waiting` como inativo. [R1, R2]                   | Status inventado retira trabalho da cobrança sem que tenha sido concluído.                                      | P0             |
| `todowrite` substitui tudo; storage apaga a lista anterior e insere a nova. Não há ID de tarefa, motivo de cancelamento ou obrigação de justificar remoção. [R1–R3]      | O modelo pode esquecer um requisito ao atualizar a lista, ou cancelar para satisfazer o lembrete.               | P0             |
| A criação é orientada por prompt; o lembrete só funciona depois que existe lista. [R2–R4]                                                                                | Requisitos que nunca viraram tarefas ficam fora do acompanhamento automático.                                   | P0             |
| Após sete continuações por todos, os loops registram warning. Isso não cria um estado de bloqueio por tarefa; Goal e outros hooks ainda podem interferir na parada. [R4] | A execução pode ficar ociosa com trabalho pendente e sem explicação acionável no modelo de tarefas.             | P0             |
| Plan preserva conteúdo e revisão, autoriza e troca para Build, mas não materializa um conjunto de tarefas vinculado à revisão aprovada. [R5]                             | O modelo precisa reinterpretar o plano e recriar o acompanhamento; itens podem sumir entre planejar e executar. | P1             |
| A conclusão robusta existe em Goal V2; a tarefa comum continua tendo todo declarativo. [R3, R6]                                                                          | Marcar todo como concluído não passa pela mesma verificação de Goal.                                            | P1             |
| O TUI usa SDK/rotas legadas com `GoalRuntime`; o Server V2 usa `SessionGoal` e outro caminho de conclusão. [R7, R8]                                                      | Uma melhoria restrita ao Core V2 pode não chegar ao fluxo utilizado no terminal.                                | P0 transversal |

### O que já funciona e deve ser preservado

- Os dois loops já continuam por todos pendentes; não propor “adicionar um loop de todos” como se faltasse. [R4]
- Plan legado e V2 já leem e preservam a revisão do plano; o problema agora é produzir e reconciliar tarefas de execução, não simplesmente salvar Markdown. [R5]
- Goal V2 lê arquivos reais, executa gates configurados, consulta um revisor separado e verifica hashes novamente depois dos efeitos das ferramentas. Também barra conclusão com todos ativos, jobs Design pendentes ou steering novo. Isso é mais forte do que o Goal declarativo do DeepSeek. [R6]
- Goal legado já considera resultados de ferramentas e gates, espera jobs registrados em execução e rejeita conclusão sem evidência observada. Ainda usa uma janela textual de resultados — não equivale ao protocolo de arquivos e hashes do V2. [R7]
- O legado já tem um guard de repetição de ferramentas; o runner V2 ainda lista essa cobertura como pendente. Não adicionar outro detector sem conferir paridade. [R9]

### Limite da conclusão

Esses achados sustentam a hipótese de acompanhamento frágil. Não demonstram que uma execução específica sua falhou por esses caminhos. Para estabelecer frequência e causalidade, precisamos medir traces de tarefas representativas, incluindo paradas sem lista, requisitos omitidos, cancelamentos e handoffs Plan → Build.

## 5. Fluxo recomendado

Proposta para uma solicitação como “corrija os três problemas e valide”:

1. **Capturar o compromisso:** registrar os três resultados pedidos e como observar sua conclusão. Isso deve acontecer junto ao início da investigação, sem outra entrevista quando o pedido já é suficiente.
2. **Preparar a execução:** executar o preflight/worktree existente, identificar capacidades e escolher a primeira tarefa acionável. Um pedido pequeno não precisa passar por Plan ou Design.
3. **Executar:** ferramentas produzem resultados vinculados à tarefa atual; novas instruções atualizam o escopo explicitamente. Concluir uma tarefa libera a próxima; uma falha reparável vira ação de recuperação.
4. **Verificar:** registrar evidência proporcional ao critério — execução de teste, cenário de UI, arquivo revisto ou aprovação humana da revisão correspondente. Alterações posteriores invalidam a evidência afetada.
5. **Encerrar:** entregar resumo do que foi feito e provado. Se resta algo, manter a tarefa e explicar bloqueio, decisão humana ou limite de orçamento, com próxima ação concreta.

Goal representa o resultado final; tarefas representam unidades executáveis; Plan representa a decisão de implementação; Design representa decisões e evidências visuais. São responsabilidades diferentes, mas o usuário não deveria precisar coordená-las manualmente. Esta é a proposta de produto, não uma alegação sobre capacidade já entregue.

## 6. Próximas mudanças, em ordem

### P0 — Tornar tarefas confiáveis nos dois caminhos de execução

- Adotar IDs estáveis, revisão, enum de estados e transições explícitas. Conservar tarefas pendentes quando o modelo envia uma atualização parcial; remoção/cancelamento exige motivo e deve preservar histórico.
- Separar `blocked` de `cancelled`: indisponibilidade temporária não cancela um requisito. Mudança de escopo deve apontar para a instrução que a originou; pedir confirmação só se o usuário ainda não decidiu a mudança.
- Registrar próxima ação e motivo de espera. O limite de continuação deve produzir estado observável, nunca equivaler a sucesso.
- Reutilizar uma política compartilhada no legado e V2; evitar dois contratos semânticos para o mesmo todo. Mudança de Schema/Protocol demanda geração do Client conforme AGENTS.md.
- Migrar estados antigos sem perder material: preservar valor original desconhecido e exigir reconciliação, em vez de converter silenciosamente em concluído.

### P1 — Pedido e plano aprovado virarem execução acompanhada

- Instruir cobertura item a item em pedidos enumerados e medir omissões. Usar uma operação limitada de criação/reconciliação de tarefas, preservando IDs em revisões.
- No handoff Plan → Build, criar ou vincular tarefas à revisão aprovada de forma idempotente. Falha nessa operação não deve fingir que a execução começou corretamente.
- Avaliar criação automática de Goal para pedidos substantivos, sem exigir `/goal`; preservar escopo e orçamento, e nunca transformar um pedido informativo em trabalho de implementação.
- Expor tarefa atual, resultados concluídos e motivo da parada na UI existente, sem acrescentar uma família de comandos obrigatória.

### P1 — Provar conclusão sem transformar tudo em um juiz caro

- Capturar evidência dos resultados reais das ferramentas: identidade, diretório/worktree, saída, exit code, revisão e critério coberto. Arquivo de teste escrito não é teste executado; teste focado não é suite inteira.
- Aplicar primeiro regras determinísticas: tarefa pendente, evidência desatualizada ou job necessário em andamento impedem conclusão. Usar revisão por modelo onde há avaliação semântica, como no Goal existente.
- Executar checks na worktree da tarefa. Distinguir jobs necessários de servidores auxiliares que podem continuar depois da entrega.
- Para documentos e pesquisa, evidência pode ser o artefato revisado e suas fontes; não exigir execução de testes sem comportamento de runtime a validar.

### P2 — Recuperação e aprendizado guiados por resultados

- Lembretes intermediários com orçamento pequeno, orientados por mudança de estado e evidência, não por número bruto de mensagens.
- Detectar repetição sem deixar ferramentas de bookkeeping reiniciarem a sequência. Polling autorizado de jobs usa política própria, para não ser confundido com loop inútil.
- Recuperação preserva estado e respeita interrupção: continuar em processo ativo é diferente de repetir operação externa depois de crash.
- Só depois avaliar tarefas entre sessões e dispatcher. A referência de Hermes é boa para esse futuro, mas antecipá-la aumentaria o número de peças antes de medir entrega melhor.

## 7. Como comprovar a melhoria

Antes de expandir funcionalidades, medir baseline e versão candidata com o mesmo modelo, configuração e conjunto de pedidos. Repetir casos para reduzir variação; não anunciar ganho percentual antes de observar resultados.

| Cenário                                                     | Critério de sucesso                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pedido com cinco correções explícitas                       | Cinco requisitos rastreados até evidência; nenhum desaparece durante atualizações. |
| “Consegue corrigir isso?” em português                      | Reconhece pedido acionável sem depender da pontuação.                              |
| Modelo escreve plano e tenta parar                          | Com execução já autorizada, começa a próxima ação; não entrega só promessa.        |
| Aprovação do plano repetida/reconectada                     | Uma única materialização das tarefas para aquela revisão.                          |
| Verificação falha                                           | Falha permanece visível; correção e nova verificação precedem conclusão.           |
| Modelo inventa `done`, remove ou cancela item para encerrar | Validação/reconciliação preserva o compromisso; não há sucesso silencioso.         |
| Item bloqueado e outro independente pronto                  | Preserva o bloqueado com motivo e executa o item alcançável.                       |
| Usuário faz pergunta de status no meio                      | Responde sem descartar o objetivo anterior nem reiniciar tarefas já concluídas.    |
| Compactação e retomada explícita                            | Recupera tarefas, escopo, autorização e revisão; não reconstrói tudo da narrativa. |
| Check passa e arquivo muda depois                           | Evidência afetada deixa de sustentar conclusão.                                    |
| Budget termina ou usuário interrompe                        | Estado explicável e retomável; nenhuma alegação de conclusão.                      |
| Pedido somente de estudo ou Plan                            | Entrega estudo/plano; não modifica runtime sem autorização.                        |

Métricas principais: tarefas entregues sem “continue” humano; cobertura dos requisitos; falsas conclusões; tempo até primeira ação útil; repetições sem progresso; intervenções humanas evitáveis; custo por resultado verificado. Contagem de todos concluídos isoladamente é uma métrica fácil de inflar.

## Questões abertas

- A frequência relativa das falhas no TUI versus no Server V2 ainda exige traces reais.
- Critérios livres exigem algum julgamento do modelo; um enum e um banco não comprovam cobertura semântica sozinhos.
- Precisamos definir quais evidências invalidam com quais alterações para evitar tanto falso sucesso quanto repetir a suite inteira por uma mudança irrelevante.
- Automaticidade de Goal deve ter orçamento e escopo claros. Não copiar execução ilimitada, retries pós-crash ou heurísticas de pontuação.

## Hotlinks e notas por fonte

Todas as fontes abaixo são arquivos dos repositórios oficiais, fixados nos commits examinados. Os intervalos e nomes citados no texto descrevem esses snapshots, não branches móveis.

- **O1:** [Descrição de todo](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/prompts/tools/todo.md) — cobertura integral, operações e bloqueios.
- **O2:** [TodoTracker](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/session/todo-tracker.ts) — eager, lembretes intermediários, stop e reidratação.
- **O3:** [Configurações](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/config/settings-schema.ts) — `todo.eager`, limites e `features.unexpectedStopDetection`.
- **O4:** [Implementação de todo](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/tools/todo.ts) — estados, normalização e persistência.
- **O5:** [Handoff de plano aprovado](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/prompts/system/plan-mode-approved.md) — plano → todos → execução.
- **O6:** [Classificador de parada](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/session/unexpected-stop-classifier.ts) — intervenção semântica opcional.
- **H1:** [Todo tool](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/tools/todo_tool.py) — IDs, parent, merge, revisão e instrução de verificação.
- **H2:** [Agente e reidratação](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/run_agent.py) — `_hydrate_todo_store` e correspondência com chamadas reais.
- **H3:** [Protocolo no prompt](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/agent/prompt_builder.py) e [guia Kanban](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/website/docs/user-guide/features/kanban.md) — lifecycle, dependências e revisão.
- **H4:** [Stop de worker](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/agent/kanban_stop.py) e [dispatcher](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/hermes_cli/kanban_db_dispatch.py) — lembrete e violação de protocolo.
- **H5:** [Verify on stop](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/agent/verification_stop.py) e [registro de evidências](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/agent/verification_evidence.py) — comportamento opt-in e escopo de checks.
- **H6:** [Ferramentas Kanban](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/tools/kanban_tools.py) e [conclusão no banco](https://github.com/NousResearch/hermes-agent/blob/f6ddd89692dff1f900983a16208f39a1485a14eb/hermes_cli/kanban_db.py) — transições, referências e preservação de artefatos.
- **D1:** [Todo tool](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/todo/tool-todo/src/index.ts) — schema, validação, eventos e reset da projeção.
- **D2:** [Goal tools](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/goal/tool-goal/src/index.ts) e [autoridade](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/goal/tool-goal/src/authority.ts) — inferência, ID/revisão, origem humana e rounds.
- **D3:** [Driver de Goal](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/goal/goal-round-driver/README.md), [implementação](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/goal/goal-round-driver/src/index.ts) e [prompt](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/goal/goal-round-driver/src/prompt.ts) — continuação e limites declarados.
- **D4:** [Repeat tool reminder](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/guard/repeat-tool-reminder/src/index.ts) — canonização, limiares e exclusões transparentes.
- **D5:** [Plan mode](https://github.com/deepseek-ai/deepseek-harness/blob/b2e3b2a0125854567a4a5fcba75782e42fe84901/packages/plan/plan-mode/README.md) — aprovação e separação entre orientação textual e enforcement.
- **R1:** [Todo schema](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/schema/src/session-todo.ts) — campos e strings livres.
- **R2:** [Todo Core](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/session/todo.ts) e [teste existente](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/test/session-todo.test.ts) — classificação de ativos e substituição integral.
- **R3:** [Ferramenta V2](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/tool/todowrite.ts) e [storage legado](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/session/todo.ts) — atualização declarativa.
- **R4:** [Loop V2](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/session/runner/llm.ts) e [loop legado](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/session/prompt.ts) — guidance e limite de sete continuações.
- **R5:** [Plan V2](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/tool/plan.ts), [Plan legado](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/tool/plan.ts) e [registro de planos](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/session/plan.ts) — aprovação imutável e handoff.
- **R6:** [Goal tools V2](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/tool/goal.ts), [settlement](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/session/goal-completion.ts) e [estado de Goal](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/session/goal.ts) — evidência, gates, hashes, budgets e steering.
- **R7:** [GoalRuntime legado](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/session/goal-runtime.ts), [decisão](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/session/goal.ts) e [claim](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/tool/goal.ts) — juiz e evidência textual de ferramentas.
- **R8:** [SDK usado pelo TUI](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/tui/src/context/sdk.tsx), [rotas legadas](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/server/routes/instance/httpapi/handlers/session.ts) e [Server V2](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/server/src/handlers/session.ts) — caminhos distintos.
- **R9:** [Processor legado](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/redcode/src/session/processor.ts) e [runner V2](https://github.com/reddb-io/redcode/blob/4f5cad15d92d1010a13c2a4603748ca4b9122832/packages/core/src/session/runner/llm.ts) — cobertura de repetição.
- **R10:** [ADR 0001](../adr/0001-hybrid-cordis-effect-plugin-runtime.md) e [AGENTS.md](../../AGENTS.md) — preservar Effect, direção das dependências e invariantes SessionV2.
