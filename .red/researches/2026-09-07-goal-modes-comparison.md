# Goal, Plan e Design: auditoria e referências externas

Data: 2026-09-07

Pergunta: “o que a gente ainda pode melhorar no nosso /goal e no nossos modes: [design] e [plan]? que que a gente pode aprender com o hermes, pi, oh-my-pi, codex?”

Escopo: crítica de produto e arquitetura, com leitura do código local e de fontes oficiais. Este documento recomenda prioridades; não constitui um plano de implementação aprovado. Nenhum runtime foi modificado e nenhum teste foi executado nesta auditoria.

## Síntese

A maior oportunidade é dar continuidade ao objetivo, às decisões e às evidências entre modos. O Design V2 em desenvolvimento já inclui boa parte das funcionalidades que faltavam no Design publicado. A prioridade agora é completar Goal e Plan no SessionV2, fazer as capacidades corresponderem à promessa de cada modo e tornar verificável a conclusão do trabalho.

O modelo de produto recomendado é:

| Conceito | Responsabilidade | Resultado observável |
| --- | --- | --- |
| Goal | Manter um objetivo, acompanhar critérios e controlar continuidade | Critérios cumpridos, pendentes ou bloqueados, com evidências e consumo |
| Design | Resolver a experiência e a direção visual | Revisão escolhida, decisões, assets e resultados de revisão |
| Plan | Resolver como implementar dentro do escopo autorizado | Plano executável, revisão identificada e verificações |
| Build | Implementar e verificar o trabalho autorizado | Mudança funcional e provas dos critérios |

Goal deve funcionar por cima dos modos. Um objetivo de Design pode terminar em um protótipo aprovado; um objetivo de Plan pode terminar no plano. Não é necessário passar por todos os modos em toda tarefa. Mudar de modo não amplia, por si só, a autorização do usuário.

## Estado examinado e limites

- A referência publicada foi a tag `v0.21.2`, resolvida para o commit `cfb4953af68d2d2bdbb8eda9f77ffcc437c2dc47`, lida com `git show` no clone de release. Seu HEAD de trabalho é diferente da tag.
- A árvore original contém trabalho não commitado de Design V2, além de outras alterações. As observações sobre `packages/core/src/design`, `packages/core/src/tool/design.ts`, `packages/schema/src/design.ts` e `specs/design` descrevem esse trabalho local, não funcionalidades já entregues na v0.21.2.
- As referências externas foram lidas em commits fixos, listados abaixo. Documentação de um concorrente comprova sua descrição pública; não comprova desempenho superior no Redcode.
- `.red/CONTEXT.md` não estava presente. O [ADR 0001](../adr/0001-hybrid-cordis-effect-plugin-runtime.md) e as instruções de SessionV2 orientam as recomendações: Effect mantém ownership e limpeza; SessionExecution continua process-global, com admissão durável e entrega em pontos seguros. Não se recomenda trocar o runtime por um fork externo.
- A validação anterior do Design é um registro de outra execução. Ela declara uso de fixtures sem avaliação de qualidade de um modelo externo ou geração paga de imagens. Os benchmarks registram latência maior, sem causalidade estabelecida: [validation.md](../../specs/design/validation.md).

## Fontes oficiais

### Hermes — NousResearch/hermes-agent

Commit: `5280fe99872a58f1b9d25b00a79d240ecd035f7d`.

- **H1 — [Memory](https://github.com/NousResearch/hermes-agent/blob/5280fe99872a58f1b9d25b00a79d240ecd035f7d/website/docs/user-guide/features/memory.md)**: documentação oficial de memória limitada, perfil de usuário e busca de sessões.
- **H2 — [Skills](https://github.com/NousResearch/hermes-agent/blob/5280fe99872a58f1b9d25b00a79d240ecd035f7d/website/docs/user-guide/features/skills.md)**: `/learn` e carregamento progressivo de referências.
- **H3 — [Session lifecycle](https://github.com/NousResearch/hermes-agent/blob/5280fe99872a58f1b9d25b00a79d240ecd035f7d/docs/session-lifecycle.md)**: distingue recuperação que preserva a sessão de suspensão que força nova identidade.

### Pi — earendil-works/pi

Commit: `b2602be77cb7b0de45dd616407fd210daa48aa75`. O endereço antigo `badlogic/pi-mono` redirecionou para este repositório na consulta.

- **P1 — [Coding agent README](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/README.md)**: núcleo pequeno, extensões, steering/follow-up e árvore de sessões.
- **P2 — [Plan mode example](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/examples/extensions/plan-mode/README.md)**: exemplo de extensão, não Plan integrado ao núcleo; ferramentas de escrita desabilitadas, filtro de Bash, widget de progresso e persistência.
- **P3 — [Compaction](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/docs/compaction.md)**: compactação e resumos de ramificações com registro de operações em arquivos.

### Oh My Pi — can1357/oh-my-pi

Commit: `daf07999c2fee9b22edc7bf8fea1fb6272e0df5e`.

- **O1 — [Plan instructions](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/packages/coding-agent/src/prompts/system/plan-mode-active.md)**: plano autossuficiente, perguntas sobre decisões que o código não resolve e opções de execução com contexto mantido, compactado ou novo.
- **O2 — [Approved plan resolution](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/packages/coding-agent/src/plan-mode/approved-plan.ts)**: resolve e lê o arquivo antes da aprovação; erro explícito quando nenhum arquivo é encontrado.
- **O3 — [Plan handoff](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/packages/coding-agent/src/plan-mode/plan-handoff.ts)**: carrega conteúdo do plano para subagentes; o comentário de contrato proíbe tratar rascunho de exploração como aprovado.
- **O4 — [Agent Hub](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/docs/agent-hub.md)**: atividade, consumo, última atividade, transcripts e intervenção por agente.
- **O5 — [Session operations](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/docs/session-operations-export-share-fork-resume.md#fresh)**: `/fresh` reinicia estado de stream do provider preservando o transcript; exige interromper ou terminar o streaming antes.
- **O6 — [README](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/README.md)**: browser via `eval` e supervisão de jobs/processos via `hub`.

### Codex — documentação oficial OpenAI

Páginas consultadas em 2026-09-07; não são snapshots fixados por commit.

- **C1 — [Follow a goal](https://learn.chatgpt.com/use-cases/follow-goals)**: objetivo durável, condição verificável de parada, referências iniciais, checkpoints e controle de pausa/retomada.
- **C2 — [App Server](https://learn.chatgpt.com/docs/app-server)**: item `plan`, eventos finais autoritativos, `turn/steer`, `turn/interrupt`, perguntas estruturadas e controle de comandos.

## O que aprender de cada projeto

| Referência | Comportamento observado | Aplicação recomendada no Redcode | Limite da comparação |
| --- | --- | --- | --- |
| Hermes | Memória compacta separada de busca do histórico; `/learn` cria conhecimento reutilizável e referências são carregadas sob demanda [H1–H2] | Registrar preferências de Design e lições de execução com origem, escopo e resultado verificado; recuperar apenas o relevante | Escrita automática do Hermes é uma escolha daquele produto. Não implica habilitar memória automática aqui nem executar plugins gerados pelo modelo |
| Pi | Steering e follow-up têm entrega e atalhos distintos; árvore preserva alternativas [P1] | Mostrar claramente “corrigir agora” e “executar depois”; explorar variantes sem perder a decisão anterior | Redcode V2 já distingue steer/queue. O ganho é completar exposição e consistência, não inventar outra fila |
| Pi | Plan aparece como extensão pequena, com progresso persistido [P2] | Compor comportamento e apresentação de modo sobre um runtime comum | Filtro textual de shell não comprova isolamento. Marcadores `[DONE:n]` não são prova de sucesso |
| Oh My Pi | Plano precisa funcionar com outro agente/contexto; arquivo é lido antes da aprovação [O1–O3] | Plano revisável, executável e vinculado à revisão escolhida; compactação preserva decisões e autorização | Não copiar toda a cerimônia nem supor que essa implementação oferece aprovação imutável por hash |
| Oh My Pi | Hub mostra atividade e consumo e permite intervenção; `/fresh` separa recuperação do provider de apagar a conversa [O4–O5] | Status acionável para jobs e recuperação específica para a camada que falhou | `/fresh` não recupera um event loop bloqueado nem restaura sozinho um terminal travado |
| Codex | Goal orientado por contrato verificável; plano é item próprio no protocolo [C1–C2] | Critérios e evidências com identidade, plano separado de comentário, estado final consistente em TUI/App | C1 é orientação pública de uso, não prova de que o runtime valida deterministicamente todo objetivo |

## Oportunidades priorizadas

### 1. P0 — Completar Goal e Plan no mesmo runtime do Design V2

**Arquivos:** [goal-runtime.ts](../../packages/redcode/src/session/goal-runtime.ts), [plan.ts](../../packages/redcode/src/tool/plan.ts), [builtins.ts](../../packages/core/src/tool/builtins.ts), [design.ts](../../packages/core/src/tool/design.ts), [handler de sessão V1](../../packages/redcode/src/server/routes/instance/httpapi/handlers/session.ts).

**Problema observado:** GoalRuntime e PlanExit usam SessionV1. O catálogo Core lista `plan_exit` como port pendente e não registra `goal_complete`. Já o Design local publica `SessionEvent.AgentSwitched` para Plan. Assim, o caminho de produto depende de capacidades repartidas entre runtimes. Os trechos V1 também estão na tag publicada.

O handler de `/goal` escolhe o agente da última mensagem de usuário, não recebe o modo selecionado no composer. Isso cria uma divergência possível quando o usuário troca o modo e inicia um goal sem enviar antes uma mensagem comum. O comportamento do handler foi confirmado; a jornada de UI não foi reproduzida nesta auditoria.

**Recomendação:** concentrar lifecycle do Goal e transições de modo na SessionV2, mantendo a admissão durável e o coordenador existente. TUI, App e retomada devem observar o mesmo modo efetivo. Evitar um terceiro loop de execução e evitar ponte de retorno a SessionPrompt V1.

**Benefício:** maior locality do comportamento de sessão; uma mesma interface de sessão pode ser testada por clientes diferentes sem reimplementar decisões de continuidade.

**Provas de aceitação propostas:** iniciar Goal em Plan sem alterar produto; Design aprovado continuar em Plan; execução autorizada avançar para Build; pausar durante juiz lento não ser desfeito por resultado atrasado; retry de admissão não duplicar trabalho; reinício preservar objetivo e exigir retomada conforme a política existente.

### 2. P0 — Fazer a promessa dos modos valer para todas as ferramentas

**Arquivos:** [agentes Core](../../packages/core/src/plugin/agent.ts), [Bash Core](../../packages/core/src/tool/bash.ts), [agentes V1](../../packages/redcode/src/agent/agent.ts), [prompt Plan V1](../../packages/redcode/src/session/prompt/plan-mode.txt).

**Problema observado:** Plan e Design restringem a ação `edit`, mas herdam permissão padrão ampla; Bash verifica a ação `bash` e documenta execução com autoridade do usuário host. Restringir ferramentas de edição não confina escrita feita por shell. Há também uma contradição explícita no Plan V1: seu prompt manda chamar `general`, enquanto a configuração nega essa delegação.

**Recomendação:** definir capacidades coerentes por modo, incluindo shell, MCP/plugins e delegação. Plan pesquisa e escreve seus artefatos de planejamento; Design trabalha na área de protótipo e assets; alterações de produto seguem o escopo autorizado. Escolher a política de execução de forma explícita, sem chamar restrições de ferramenta de sandbox.

**Benefício:** a interface do modo descreve o comportamento real; reduz diferenças entre caminhos de ferramentas e facilita testar o mesmo contrato contra adapters de execução distintos.

**Provas propostas:** tentar a mesma alteração fora do escopo via edit, shell e ferramenta externa e verificar resultado consistente; avaliar comandos necessários para pesquisar ou preparar o preview para evitar um modo inutilizável. O exemplo do Pi é inspiração de composição, não prova de segurança de allowlist [P2].

### 3. P0 — Goal concluir por evidência ligada ao trabalho

**Arquivos:** [goal-runtime.ts](../../packages/redcode/src/session/goal-runtime.ts), [goal.ts](../../packages/redcode/src/session/goal.ts), [aprovação de Design](../../packages/core/src/design/store.ts).

**Já existe:** objetivo persistido em metadata, contrato com outcome/verification/constraints/boundaries/stop_when, gates shell opcionais, juiz separado, claim, pausa/retomada, WAIT e defesa contra deriva. Não é necessário recriar esses conceitos.

**Problema observado:** o juiz recebe os últimos 8.000 caracteres dos textos da última resposta, contrato e claim textual; sua chamada tem `tools: {}`. Os gates são verificações executadas pelo harness, mas o juiz não inspeciona diretamente os artefatos. `decide` aceita `done` sem claim e permite esse resultado com trabalho de background ainda ativo.

**Recomendação:** vincular critérios a evidências identificáveis: check e resultado, revisão/arquivo examinado, cenário exercitado ou aprovação humana correspondente. O juiz pode avaliar suficiência e sugerir próximos passos; a conclusão deve considerar a existência, atualidade e cobertura das provas. Distinguir jobs necessários ao objetivo de processos auxiliares que podem continuar, como um servidor de preview.

Exemplo conceitual: “protótipo aprovado na revisão R; cenário de login exercitado em R; implementação comparada contra R; check executado após a última alteração relevante”. Critério subjetivo de direção visual pode ser cumprido por decisão humana registrada, sem inventar um teste numérico de beleza.

**Benefício:** Goal, Plan e Design compartilham evidências em vez de reinterpretar apenas texto do chat. Melhor testabilidade da conclusão e menor risco de aprovação de conteúdo desatualizado.

**Provas propostas:** uma resposta confiante sem evidência não concluir critério obrigatório; alteração posterior invalidar a evidência afetada; job necessário pendente impedir conclusão; check válido e aprovação da revisão correta satisfazerem os respectivos critérios. Inspiração: contrato e checkpoints de Codex [C1], estendidos aqui como proposta de produto.

### 4. P1 — Plan virar um artefato de execução confiável

**Arquivos:** [plan.ts V1](../../packages/redcode/src/tool/plan.ts), [Plan prompt](../../packages/redcode/src/session/prompt/plan-mode.txt), [DesignStore.approve](../../packages/core/src/design/store.ts).

**Problema observado:** `plan_exit` monta o caminho e apresenta o plano como completo sem ler o arquivo nessa operação. Depois injeta uma mensagem para executar um arquivo mutável, enquanto o retorno da ferramenta diz esperar novas instruções. A revisão aprovada não fica identificada nesse fluxo. Design V2 já oferece uma referência local melhor: pacote de aprovação imutável e atualização de seção delimitada do plano, preservando o restante.

**Recomendação:** plano autossuficiente, com objetivo, decisões relevantes, mudanças ordenadas, dependências e prova de conclusão. Ler o conteúdo antes de apresentar sua conclusão; identificar a revisão autorizada; mostrar mudanças posteriores. Perguntas devem resolver preferências ou conflitos reais, enquanto fatos do código são pesquisados. Reutilizar autorização já concedida, sem pedir confirmação repetida para cada etapa.

**Benefício:** handoff para Build, outra sessão ou outro agente mantém intenção e escopo. A interface de aprovação pode ser verificada contra conteúdo concreto. Oh My Pi oferece referências práticas para a autossuficiência e a leitura do arquivo; Codex separa o item `plan` dos comentários [O1–O3, C2].

**Provas propostas:** plano ausente não ser anunciado como pronto; nova sessão conseguir executar o plano sem reconstruir decisões no transcript; mudança de revisão ser visível; aprovação iniciar a ação que a UI anunciou, sem instruções contraditórias.

### 5. P1 — Design fechar o ciclo de revisão e entrega

**Arquivos:** [schema Design](../../packages/schema/src/design.ts), [store.ts](../../packages/core/src/design/store.ts), [renderer.ts](../../packages/core/src/design/renderer.ts), [tool/design.ts](../../packages/core/src/tool/design.ts), [validação](../../specs/design/validation.md).

**Já existe no trabalho V2:** brief, decisões e perguntas; revisões/restauração; fontes do design system com hash; feedback com identidade e entrega steer/queue; assets e capacidades de imagem via MCP/plugins; Excalidraw; SVG→GIF; cenários e Axe em múltiplas larguras; comparação com implementação; pacote imutável de aprovação.

**Problema observado:** o renderer produz findings e cenários exercitados em HTML. `completed` indica que o job terminou, inclusive se encontrou problemas; isso é uma semântica válida de job, mas não representa qualidade aprovada. O pacote de aprovação grava revisão, assets e feedback, sem os resultados dos jobs de auditoria. A pergunta de aprovação já mostra questões abertas; falta ligar o conjunto de evidências à decisão.

**Recomendação:** mostrar, por revisão, cenários exercitados, achados, feedback resolvido/pendente e exceções aceitas. Carregar essa evidência para Plan e Goal. Oferecer comparação de direções lado a lado e justificar diferenças com o brief; registrar a escolha sem exigir três variantes em toda correção pequena. Na entrega, separar assets editáveis e exportados, com SVG como fonte e GIF como resultado quando aplicável.

**Benefício:** o usuário avalia uma revisão identificada e vê o que está incompleto; Build recebe a mesma referência. A infraestrutura já construída ganha utilidade sem outro catálogo de ferramentas. Pi inspira preservação de alternativas [P1]; browser do Oh My Pi é referência de controle [O6], mas não é uma capacidade ausente no Redcode.

**Provas propostas:** aprovação mostrar auditoria da revisão correta; findings não desaparecerem ao mudar de modo; uma anotação resolvida apontar para a revisão que a tratou; comparação usar a revisão aprovada, sem substituir silenciosamente a referência por um rascunho novo.

### 6. P1 — Tornar espera, custo e recuperação compreensíveis

**Arquivos:** [goal.ts](../../packages/redcode/src/session/goal.ts), [goal-runtime.ts](../../packages/redcode/src/session/goal-runtime.ts), [teste de orçamento](../../packages/redcode/test/session/prompt.test.ts), [Goal dock](../../packages/app/src/pages/session/composer/session-goal-dock.tsx), [renderer.ts](../../packages/core/src/design/renderer.ts).

**Problemas observados:**

- O contador de Goal incrementa em continuação. O teste em `prompt.test.ts:3100` codifica `maxTurns: 1` com duas respostas; “turnos” não descreve bem o que está sendo limitado.
- Gates rodam antes da decisão de WAIT, podendo verificar novamente durante espera.
- Jobs de renderização recebem `running` antes de obter o semáforo de execução, dificultando distinguir fila de atividade.
- GIF usa decode PNG, quantização e encoding síncronos por frame. O finalizer chama `browser.close()` sem timeout explícito naquele ponto. São riscos a medir, não causa demonstrada do congelamento relatado pelo usuário.

**Recomendação:** expor etapa, última atividade, evidências recentes, espera e bloqueio; esclarecer se o orçamento mede turnos, continuações, tokens, tempo ou custo. Contabilizar consumo de juiz/subagentes quando disponível; representar dados ausentes como desconhecidos. Separar jobs queued/running e dar prazo/cancelamento a trabalho demorado. Fazer profiling antes de decidir isolamento em worker/processo. Repetir gates quando a evidência relevante mudar, com tratamento próprio para checks dependentes de estado externo.

Propor recuperação específica por camada: cancelar job, interromper provider, reiniciar estado de transporte preservando transcript, ou reparar terminal. Um comando inspirado em `/fresh` só trata a camada de provider; não é correção genérica para travamentos [O5]. Preservar retomada explícita após crash: a recuperação de contexto documentada pelo Hermes não autoriza repetir automaticamente chamadas ou geração paga [H3].

**Benefício:** usuário consegue intervir e entender o que consome tempo. Reduz acoplamento entre progresso visual e lifecycle real. O Hub do Oh My Pi oferece um bom exemplo de atividade, uso e controles acionáveis [O4]; os controles de turn/command do Codex distinguem interrupções [C2].

**Provas propostas:** orçamento ter significado inequívoco; WAIT não consumir continuação nem refazer check sem motivo; cancelamento devolver controle sob carga; jobs enfileirados exibirem fila; reinício não duplicar efeitos externos. Definir metas de latência após coletar baseline isolado, sem declarar SLA ainda não medido.

### 7. P2 — Aprender com resultados e medir qualidade de experiência

**Fontes/arquivos:** [Design validation](../../specs/design/validation.md), Hermes [H1–H2], Pi [P3], Codex [C1].

**Lacuna de evidência:** a validação registrada cobre UI, storage, contratos, browser e fixtures. Ela declara não avaliar a qualidade de decisão de um modelo externo nem o resultado de geração paga. Passar contratos não demonstra bom planejamento, escolha de ferramenta ou direção visual.

**Recomendação:** pequena suíte de tarefas representativas executadas com modelos reais antes de expandir funcionalidades: tarefa apenas de Plan, protótipo com revisão, SVG→GIF, implementação a partir de aprovação e interrupção/retomada. Medir sucesso observável, correções solicitadas, tempo até preview útil, custo e abandono por bloqueio.

Depois de entregas verificadas, oferecer aprendizado com origem e escopo: preferência visual, escolha de design system, comando de validação que funcionou, decisão rejeitada e razão. Separar fatos e preferências de procedimentos; preservar decisões/autorizações na compactação e buscar histórico sob demanda. Não transformar uma tentativa malsucedida em receita nem carregar o histórico inteiro em todo prompt. Isto é uma recomendação futura; não habilita escrita de memória nesta auditoria.

**Benefício:** evolução guiada por melhoria observada nas tarefas, com contexto mais útil e menor repetição de erros. A estratégia do Hermes é referência de organização e carregamento, não comprovação automática de melhoria dos modelos.

## Ordem recomendada de trabalho

1. **Coerência:** decidir e completar a ownership de Goal/Plan em SessionV2; alinhar modo efetivo, permissões e transições; remover instruções contraditórias.
2. **Confiança:** relacionar critérios a provas e revisões; tornar plano e aprovação concretos; esclarecer orçamento e estados de jobs.
3. **Experiência:** apresentar revisão/evidências de Design, melhorar intervenção e recuperação e medir as jornadas com modelos reais.
4. **Aprendizado:** após baseline, selecionar memória e reutilização que reduzam correções e custo nas tarefas representativas.

O primeiro corte útil é uma jornada pequena, completa e demonstrável: Goal em Design → protótipo revisado → Plan identificado → implementação quando autorizada → checks e comparação → conclusão com evidência. A mesma base deve permitir encerrar o objetivo no Design ou no Plan quando esse for o pedido.

## Questões em aberto

- Qual superfície V2 será o caminho de produto principal para Goal e Plan, e quais compatibilidades V1 precisam permanecer durante a migração?
- Quais critérios exigem checks executáveis, julgamento do usuário ou avaliação do agente, por tipo de tarefa?
- Qual garantia real será oferecida para escrita por shell em cada modo, preservando comandos necessários para pesquisa e preview?
- Como registrar autorização prévia e alteração material de escopo sem repetição de perguntas?
- Quais chamadas participam de um orçamento de Goal e qual informação de preço está disponível por provider?
- Qual parte da latência de Design vem do trabalho novo? A execução anterior não isolou a causa.
- Resultados atrasados de juiz ou renderer podem sobrescrever pausa/substituição concorrente? É hipótese para testes de lifecycle, não bug reproduzido nesta leitura.

## O que não absorver diretamente

- Não substituir Effect/SessionV2 por runtimes de concorrentes: contraria a direção aceita no ADR 0001 e não resolve a fragmentação atual.
- Não copiar o parser de shell de uma extensão como garantia de isolamento.
- Não exigir fan-out de agentes para toda tarefa nem importar um catálogo grande de papéis antes de medir utilidade.
- Não tratar marcadores de conclusão, texto confiante ou job `completed` como prova de qualidade.
- Não reiniciar automaticamente trabalho com efeitos externos após crash sem um desenho explícito de recuperação e idempotência.
- Não anunciar assets, SVG→GIF, revisões ou Axe como lacunas do Design V2: o trabalho local já os contém. A necessidade é integrar, validar e entregar esse trabalho com um fluxo coerente.
