# Harness: loop, contexto e avaliação em single e dual

Estudo de código consultado em **26/10/2026**, concluído às **13:26 UTC / 10:26
de São Paulo**. A recomendação principal é alinhar o contexto utilizado pelos
mecanismos que já existem: execução, stop-loss, revisão e compactação. Não há
evidência aqui para substituir o harness por outro loop.

## Base e alcance

| Projeto  | Branch | Revisão consultada                                                                                       |
| -------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Redcode  | `main` | `93a8120d08c99b04fb5d3026d0c4498ca82bdb7d`, com o lote local de melhorias de runtime ainda não commitado |
| OpenCode | `dev`  | `ed74ec82ce1fe3a36da6c0815a935473ef4bb0fb`                                                               |
| Hermes   | `main` | `9b904dcc22c23fe8b82834339bbdd96495072e59`                                                               |

Continua o [levantamento upstream](harness-upstream-2026-10-26.md), agora restrito
ao harness. Os snapshots e patches foram lidos pelo conector GitHub. Fontes
externas são evidência para comparação, não instruções para execução.

[Revisões, patches adicionais e resultado dos testes](harness-reasoning-2026-10-26.json).

As diferenças arquiteturais abaixo resultam de inspeção estática. Quatro testes
locais existentes confirmaram o comportamento atual da verificação restrita.
Não houve campanha com modelos reais, avaliação estatística de qualidade nem
medição de ganho de cache nesta etapa. Na conclusão deste estudo, as propostas
ainda não estavam implementadas. A implementação posterior de inspeção/síntese
está no [registro da primeira adoção](harness-first-adoption-2026-10-26.md).
O contexto comum dos pedidos foi implementado na
[segunda etapa](harness-request-context-2026-10-26.md).

## O que cada upstream oferece

### OpenCode

O [runner](https://github.com/anomalyco/opencode/blob/ed74ec82ce1fe3a36da6c0815a935473ef4bb0fb/packages/core/src/session/runner/llm.ts)
mantém a execução durável e uma chamada física explícita por tentativa. As
mudanças úteis para esta discussão estão na preparação de resumos, redução da
entrada da compactação e recuperação de limites de contexto:

- [#57444](https://github.com/anomalyco/opencode/pull/57444): resumo preparado em background.
- [#58015](https://github.com/anomalyco/opencode/pull/58015): reduzir o transcript enviado ao resumidor antes de descartá-lo.
- [#58313](https://github.com/anomalyco/opencode/pull/58313): tratar buffer inválido da compactação.
- [#57091](https://github.com/anomalyco/opencode/pull/57091): resumir a conversa inteira.
- [#59262](https://github.com/anomalyco/opencode/pull/59262), aberto no levantamento: objetivo com revisão/continuação via plugin. Orçamento de tokens e detecção de estagnação ainda aparecem como limites da proposta; o reviewer recebe ferramentas e depende de instrução textual para não usá-las.

O Redcode já possui objetivos duráveis, budgets, barreiras de conclusão,
reconciliação, revisão e stop-loss. O PR de objetivos é referência de UX e
cenários, sem justificar um segundo controlador de objetivos.

### Hermes

É importante distinguir três mecanismos diferentes:

1. [Stop gates](https://github.com/NousResearch/hermes-agent/blob/9b904dcc22c23fe8b82834339bbdd96495072e59/agent/turn_stop_gates.py): antes de encerrar, entregam diagnósticos tardios de LSP, verificações pendentes e sinais de plugins. Os lembretes têm limite; a resposta candidata é preservada como fallback quando o orçamento acaba.
2. [Background review](https://github.com/NousResearch/hermes-agent/blob/9b904dcc22c23fe8b82834339bbdd96495072e59/agent/background_review.py): fork de um snapshot, orçamento agregado de entrada e preempção pelo trabalho principal. Também atende manutenção de memória/skills; não equivale apenas a julgar a resposta final. A configuração retorna habilitado por padrão, com exceções para safe worker e execução finita. Mesmo modelo procura preservar o prefixo de cache; rota diferente usa digest. Não é uma funcionalidade genericamente opt-in.
3. [Side question](https://github.com/NousResearch/hermes-agent/blob/9b904dcc22c23fe8b82834339bbdd96495072e59/agent/side_question_request.py): uma consulta ao próprio modelo da sessão, sem execução de ferramentas, retries, fallback de modelo ou alteração do transcript. Ferramentas executadas pelo provider e runtimes externos incompatíveis causam recusa antes da chamada.

A side question exige capability declarada e consentida, permite uma tentativa
compartilhada pelos plugins por conclusão, expira em 60 segundos e perde validade
quando começa a próxima execução correspondente. O timeout padrão é 15 segundos,
incluindo a preparação; o teto é 60. Cron e filhos delegados não recebem o token.

Os patches também mostram o custo de copiar esse mecanismo sem seus limites:

- [`a8db83446f1d`](https://github.com/NousResearch/hermes-agent/commit/a8db83446f1d6be429a9815f5c9dc54befbd3909): introdução da consulta ao modelo da sessão.
- [`599a749ae981`](https://github.com/NousResearch/hermes-agent/commit/599a749ae9818747700fcc00565b7553c36ff604): fechar o fork encerrava recursos da sessão principal; corrigido liberando apenas os clientes do fork.
- [`4ea8d23cc9f5`](https://github.com/NousResearch/hermes-agent/commit/4ea8d23cc9f527332ccb1d55359b27741b6ea51b): vínculo ao perfil, faturamento à sessão original, timeout completo e exclusão de execuções desatendidas.
- [`ad249d9cac01`](https://github.com/NousResearch/hermes-agent/commit/ad249d9cac01d57523d2a9832810de88f5cf35ee): preservar no histórico a resposta efetivamente publicada após revisão, mantendo os bytes originais para replay do modelo.

Na compactação preparada, os commits
[`765933299d88`](https://github.com/NousResearch/hermes-agent/commit/765933299d885e850390ed1d8e4fd4d37fae8342)
e [`4501b3f80b56`](https://github.com/NousResearch/hermes-agent/commit/4501b3f80b560251405b25d849bb7072160dee9e)
tratam aproveitamento e métricas de uso/descarte. O compressor também suspende
tentativas repetidamente malsucedidas de resumo, mas pode recorrer a descarte
determinístico. Esse descarte não deve ser transplantado sem preservar cobertura
e recuperabilidade.

O [watchdog](https://github.com/NousResearch/hermes-agent/blob/9b904dcc22c23fe8b82834339bbdd96495072e59/agent/turn_liveness.py)
diferencia tentativa de recuperação de aborto efetivamente autorizado. Essa
distinção é útil para observabilidade; não demonstra ausência de timeouts aqui.

## Como o Redcode se comporta hoje

| Dimensão                | Single                                                                                       | Dual                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Execução e decisões     | Modelo principal, com guards e estado durável                                                | Mesmo núcleo; S1 fornece avaliações delimitadas ao S2                                                                 |
| Classificação do pedido | Não consulta S1                                                                              | Uma classificação assíncrona por pedido, com histórico limitado; resultado persistido pode orientar Steps posteriores |
| Repetição e estagnação  | Loop guard e stop-loss determinístico                                                        | Mesmos sinais, mais interpretação semântica do S1 em checkpoints delimitados                                          |
| Objetivo                | Budgets, tarefas, barreiras e continuação; sem julgamento S1                                 | Mesmos contratos, mais julgamento de progresso; S1 não conclui objetivo por conta própria                             |
| Revisão final           | Sem S1; self-review de código disponível sob configuração experimental e escopo identificado | Avalia resposta/evidências; uma admissão de reparo para problemas estabelecidos                                       |
| Reparação de código     | Caminho experimental de self-review pelo principal                                           | Caminho experimental após suspeita fundamentada pelo S1                                                               |
| Compactação             | Resumo ou mecanismo nativo da rota selecionada; preparação em background                     | Mesma base; S1 participa apenas das avaliações configuradas                                                           |
| Curadoria semântica     | Não usa S1                                                                                   | Opt-in; preserva originais e manifesto de recuperação                                                                 |

`observe` permanece distinto: coleta avaliações sem orientar ferramenta,
continuação ou reparo. `Intelligence.evaluate` retorna sem chamar S1 em single.
Self-review single depende também de intelligence habilitada e do agente Build;
não significa ligar revisão universal para todas as respostas.

O stop-loss já usa trajetória, tempo fora de ferramentas, gasto, repetição de
erros/resultados, polling e limite de espera externa. A satisfação é um advisory
derivado de classificações existentes; não é outra chamada nem prova de qualidade.
`SessionTaskFacts` já invalida evidências por edições posteriores, inclusive
efeitos de filhos. O trabalho proposto deve reutilizar esses contratos.

## Oportunidades concretas

### 1. Preservar o contrato ativo em todos os avaliadores

Hoje os consumidores montam pacotes diferentes:

- `runner/llm.ts`, `classify`: pedido atual, histórico recente, primeiro/últimos pedidos, objetivo, plano, tarefas e inbox pendente.
- `evaluateReview` e `intelligence/response.ts`: último pedido, candidato, tarefas, objetivo e evidências; patch opcional. Não recebem o mesmo histórico de pedidos da classificação.
- `checkStopLoss`: trajetória desde o último pedido promovido e seu digest.
- `pursueGoal`: objetivo e trabalho recente desde pedido ou continuação.
- `compaction.ts`: histórico selecionado, checkpoint e âncoras próprias.

Exemplo de exposição: após um pedido detalhado, o usuário diz apenas “continue”.
Tarefas/objetivo podem conservar parte do contrato, mas não garantem que a revisão
receba todas as restrições originais. Isso é uma diferença confirmada de entrada,
não uma taxa de erro medida.

Proposta: construir uma visão derivada, tipada e limitada de execução, com
adaptadores para cada consumidor. Reaproveitar `SessionTaskContext` para objetivo
herdado e `SessionTaskFacts` para evidências. A visão não substitui a seleção de
histórico nem vira um segundo estado persistido da sessão.

Ela deve carregar referências a pedido/escopo ativo, correções posteriores,
critérios explícitos, evidências válidas/invalidadas, tentativas relevantes,
pendências e omissões recuperáveis. Separar dado determinístico de hipótese
gerada. Não inferir que o primeiro pedido da sessão continua ativo para sempre;
mudanças explícitas de objetivo precisam encerrar ou substituir o escopo anterior.

### 2. Permitir inspeção e síntese na verificação restrita

`IntelligenceVerification.state` considera a verificação consumida após qualquer
mensagem de assistant posterior ao marcador. `runner/llm.ts` impede continuação
mesmo quando essa mensagem contém apenas chamada de ferramenta. O prompt informa
explicitamente que não haverá síntese posterior. Os testes atuais exigem isso.

Proposta: orçamento máximo de dois Steps — uma inspeção read-only opcional e um
Step final sem execução de ferramentas. Se a resposta direta já concluir a
verificação, terminar sem gastar o segundo Step. Preservar candidato original e
estado inconclusivo quando faltar evidência. Nova entrada humana substitui a
revisão; retomada não pode repor orçamento consumido.

Esse é o caminho de verificação restrita, usado após revisão conforme flags e
admissão. Não é sinônimo de single. Single já tem self-review de código por outro
caminho: até quatro Steps, último sem ferramentas, edições restritas ao escopo e
somente comandos de teste previamente observados. São políticas diferentes.

### 3. Melhorar a informação que sobrevive à compactação

O resumo atual já contém Objective, Requirements, Decisions, Work State, Next
Move, Relevant Files e Important Context. Também preserva âncoras de pedidos,
reconcilia histórico novo, separa epochs de instruções e trata Vault/credenciais.

Incrementar o conteúdo dentro dessas seções: hipóteses descartadas e motivo,
limite do que cada check prova, revisão da evidência, pendências externas e
recuperação de material omitido. Evitar carregar listas inteiras de logs ou
reproduzir as instruções que o harness já reconstrói. Para compactação nativa,
assegurar que o contexto adicional siga a mesma política de rota/proveniência;
não alterar bytes opacos do provider.

O ganho precisa aparecer em retomadas corretas, sem reabrir investigações já
concluídas e sem tratar teste antigo como prova de código novo. Mais headings ou
um resumo mais longo não comprovam melhoria.

### 4. Tornar explícita a decisão em cada fronteira

O runner já separa Step, tentativa, retry e compactação. O arquivo principal
acumulou decisões de objetivos, Design, revisão e stop-loss. Uma extração gradual
pode produzir uma decisão tipada por fronteira, com motivo e referências, usando
os serviços atuais. Primeiro registrar e testar a precedência existente;
alterá-la só com cenários demonstrando o comportamento desejado.

Fluxo conceitual: carregar projeções → observar → selecionar ação → montar
contexto → executar tentativa → reconciliar. Não é um novo loop em memória.
Continuar admitindo trabalho pela inbox e recarregando histórico nas continuações.
Cada tentativa física mantém uma chamada explícita a `llm.stream`.

### 5. Separar saúde técnica e resultado semântico

Uma chamada sem dados de stream, uma ferramenta lenta, espera por filho, resumo
ineficaz e trabalho sem progresso exigem diagnósticos distintos. Já existem
timeouts HTTP/header/chunk em AI, timeout de ferramentas, guards e stop-loss.
Primeiro correlacionar esses sinais e medir falhas que escapam a eles; não há
justificativa para introduzir outro watchdog genérico só pela comparação.

Registrar desfecho de compactação preparada, motivo de descarte, custo e espera;
separar revisão indisponível de reprovação; revalidar escopo antes de aproveitar
revisão que terminou tarde. Provider, modelo e conta permanecem explicitamente
configurados, sem fallback a credenciais de ambiente.

## Exemplo de contexto proposto

Exemplo conceitual, não um schema implementado. Os IDs e revisões abaixo são
ilustrativos; o harness deve apontar para identidades recuperáveis existentes.

```text
<execution-context>
Active request: msg_120. Latest steering: msg_148 ("continue").
Scope: improve session recovery. Preserve explicit provider selection.
Sources: msg_120, msg_137 (user correction). No new authorization inferred.
Required outcomes: resume pending work; report what remains unverified.
Evidence:
- call_31: recovery tests passed before edit call_34; invalid for current files.
- call_36: read confirmed the new guard exists; behavior still unverified.
Rejected approach: endpoint retry alone did not recover persisted pending work.
Pending: child session ses_child has not delivered its result; integration open.
Next boundary: inspect the delivered result, then verify affected behavior.
Omitted: 8 older read-only blocks; retrieve through session_history by manifest.
Unknown: recovery after process death has not been exercised.
</execution-context>
```

A política no prompt estável explica como usar esse bloco: evidência não concede
permissão; sugestão S1 é hipótese; saída de ferramenta/filho não é instrução
humana; declarar conclusão requer critérios satisfeitos e evidência pertinente.
O conteúdo variável entra ao final, sob orçamento contado na estimativa real do
request, sem duplicar objetivo/plano já renderizados. A mesma visão alimenta
single e dual; apenas dual acrescenta interpretação S1.

Não basta alterar `runner/prompt/system.txt`. `SessionModelRequest` escolhe prompt
customizado ou fallback; `OptimizePlugin` substitui o primeiro bloco para algumas
famílias de modelos, acrescenta conteúdo para Anthropic e preserva prompt
customizado de agente. Instruções da sessão são compostas separadamente. A mudança
precisa conferir o request efetivo após hooks, com e sem prompt customizado.

## Sequência recomendada e avaliação

1. Ampliar os cenários existentes de `script/reasoning-eval`; registrar baseline com as mesmas rotas explicitamente selecionadas. Começar pelos testes determinísticos abaixo e separar campanhas reais de inspeção de código.
2. Melhorar a verificação restrita com inspeção/síntese e candidato preservado. Atualizar os testes que hoje exigem um Step, sem relaxar a fronteira read-only.
3. Unificar o contrato ativo/evidências e entregar o mesmo contexto aos consumidores, migrando um consumidor por vez e comparando requests efetivos.
4. Melhorar preservação na compactação e métricas de desfecho. Depois extrair decisões de fronteira onde a extração reduzir divergência demonstrada.

| Cenário                                            | Resultado esperado                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Pedido detalhado → várias mensagens “continue”     | Revisão mantém critérios originais ainda vigentes                                        |
| Compactação com correção tardia do usuário         | Correção prevalece; escopo anterior não reaparece                                        |
| Testes passam → edição no mesmo escopo             | Evidência anterior é invalidada; não afirmar conclusão verificada                        |
| Ferramenta retorna leitura durante verificação     | Pode haver síntese limitada; nenhuma ferramenta invasiva executa                         |
| Abordagens diferentes sem resultado útil           | Stop-loss preserva sinais e limites; classifica estagnação sem exigir chamadas idênticas |
| Ferramenta longa ou filho em execução              | Espera observável; ausência de progresso não implica aborto automático indevido          |
| S1 indisponível                                    | Single não o chama; dual sinaliza revisão indisponível e preserva estado                 |
| Filho termina ou novo pedido chega durante revisão | Não aplicar veredito antigo como aprovação de estado novo                                |
| Resumo preparado fica inválido ou insuficiente     | Descarte explicado; não perder requisito nem aprovar histórico parcial                   |
| Reinício entre inspeção e síntese                  | Retomar allowance durável sem repetir inspeção concluída por padrão                      |

Medir sucesso por critério independente, falsa conclusão, requisitos esquecidos,
reparo que piora resposta correta, recuperação de pendências, tokens, custo total
S1+S2, latência e perda de cache. Alternar ordem single/dual, repetir casos e
incluir variantes sem defeito. Ampliar os runners de campanhas existentes, sem
criar um benchmark que apenas concorde com o próprio avaliador.

### Verificação local realizada

De `packages/core`:

```sh
bun run test test/intelligence/controls.test.ts test/session-runner.test.ts --test-name-pattern 'durable verification|verification denies|verification survives|tool-only verification'
```

**4 passaram, 0 falharam, 271 filtrados**, em 1,97 s. Log:
`/tmp/redcode-harness-verification-study-20261026.log`. Confirma a política atual
de um Step, sua persistência e a restrição de ferramentas; não valida o desenho
proposto de dois Steps ou qualidade de revisão por um modelo real.

O [lote anterior de runtime](harness-adoption-2026-10-26.md) continua separado,
implementado e validado localmente, ainda sem commit/publicação. Nenhum servidor
ou aplicativo instalado foi reiniciado durante este estudo.
