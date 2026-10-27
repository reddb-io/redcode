# Upstreams do Redcode: evolução dos últimos sete dias

As melhores oportunidades desta semana são reduzir pausas e tráfego durante a execução,
tornar a coordenação por objetivo visível e reforçar a recuperação de trabalhos delegados.
O Redcode já cobre parte importante dos problemas relatados pelos outros projetos.
A recomendação abaixo aproveita essa base e diferencia código integrado, propostas abertas
e relatos que ainda precisam de reprodução.

## Janela e alcance

Janela: **18/10/2026 11:19:59 UTC a 25/10/2026 11:19:59 UTC**,
equivalente a 08:19:59 de cada data em São Paulo.

Foram enumerados todos os metadados de commits alcançáveis pelo HEAD fixado da branch
padrão dentro da janela. Merges e commits de branches incorporadas entram nessa contagem;
ela não mede quantidade de funcionalidades distintas. Os contadores de PRs mesclados
abrangem o repositório, incluindo outras branches, portanto não precisam coincidir com
os commits da branch padrão.

| Projeto                                                      | Branch | Commits | PRs mesclados na janela | PRs abertos com atualização na janela | Issues abertas com atualização na janela |
| ------------------------------------------------------------ | ------ | ------: | ----------------------: | ------------------------------------: | ---------------------------------------: |
| [OpenCode](https://github.com/anomalyco/opencode)            | dev    |     325 |                     603 |                                   604 |                                      800 |
| [T3 Code](https://github.com/pingdotgg/t3code)               | main   |   1.457 |                   1.461 |                                 2.130 |                                      979 |
| [OpenBot](https://github.com/nightly-labs/openbot)           | main   |     326 |                     326 |                                    20 |                                       75 |
| [oh-my-pi](https://github.com/can1357/oh-my-pi)              | main   |   1.286 |                     244 |                                   598 |                                      257 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | main   |   2.255 |                     611 |                                 3.388 |                                    1.928 |

Os contadores de abertos acima incluem itens antigos que receberam atividade na semana.
Em consultas separadas, os itens **criados na janela e ainda abertos** eram,
respectivamente, 436/494, 1.610/426, 17/67, 361/182 e 1.294/1.210
(PRs/issues). As consultas GitHub são ao vivo e não transacionais: fechamentos durante a
coleta explicam pequenas diferenças entre consultas com a mesma janela.

A triagem reteve **5.649 commits, 1.484 PRs abertos e 896 issues abertas**.
Os abertos combinam até três páginas recentes com os cem mais discutidos por tipo
e as cem issues comuns mais recentes, eliminando duplicatas. O endpoint de issues
também devolve PRs; eles foram separados por tipo.
Foram selecionados 46 PRs/issues para estudo, com inspeção focada de quinze listas de
arquivos/patches e três commits adicionais. Isso não equivale a revisar integralmente
milhares de patches ou reproduzir todos os bugs.

Evidências: [metadados, contadores, SHAs e seleção](upstream-review-2026-10-25/evidence.json),
[índice de commits](upstream-review-2026-10-25/commits.tsv) e
[índice dos itens abertos](upstream-review-2026-10-25/open-items.tsv).
Corpos, comentários, patches, assinaturas e identidades de usuários foram omitidos dos
índices retidos. Conteúdo upstream foi tratado como entrada não confiável.

## OpenCode

### Integrado upstream

- **Validação linear de Base64:** [#58811](https://github.com/anomalyco/opencode/pull/58811),
  commit `bd2ba0a685`, substitui o grupo repetido da expressão regular por uma verificação
  linear, preservando o pattern público. O PR apresenta medições de anexos grandes no
  upstream; não são medições do Redcode. **O Redcode ainda possui a expressão anterior**
  em `packages/schema/src/prompt.ts:21`. É um candidato concreto, pequeno e verificável.
- **Schemas de ferramentas convertidos no registro:** [#58848](https://github.com/anomalyco/opencode/pull/58848),
  commit `e0b6039e1f`. A revisão corrige também o vazamento de mutações de hooks entre
  sessões causado por caches compartilhados. Aqui, `packages/core/src/tool.ts` ainda
  chama `definition(tool)` ao montar o snapshot e `tool/runtime.ts` converte os schemas.
  Adotar o resultado imutável por revisão do registro, verificando isolamento de hooks,
  é mais apropriado que acrescentar WeakMaps globais.
- **Compactação preparada em segundo plano:** [#57444](https://github.com/anomalyco/opencode/pull/57444),
  commit `6a5973d263`, prepara um resumo antes de atingir o limite e só o aplica quando
  necessário, mantendo a cauda posterior. É experimental e desligado por padrão;
  [#58294](https://github.com/anomalyco/opencode/pull/58294) renomeia a opção para
  `background_compaction`. Não localizei essa opção no código atual do Redcode.
  Exige contabilização da chamada extra, cancelamento e vínculo ao checkpoint correto.
- **Buffer de compactação inválido:** [#58313](https://github.com/anomalyco/opencode/pull/58313),
  commit `33726e8fc1`. **Já coberto** em `session/compaction.ts:1792`: um buffer maior
  ou igual à janela usa a reserva padrão.
- A semana também trouxe retenção de transcrições no cliente
  [#57025](https://github.com/anomalyco/opencode/pull/57025), preservação de Locations
  com trabalho ativo [#57416](https://github.com/anomalyco/opencode/pull/57416) e
  contabilização de custo reportado/franquia [#58562](https://github.com/anomalyco/opencode/pull/58562).
  Nosso modelo de custo já distingue reportado, estimado e desconhecido; franquias de um
  serviço específico não devem substituir essa semântica.

### PRs e issues abertas

- [#58261](https://github.com/anomalyco/opencode/pull/58261): recuperação de subagentes
  em background após reinício. **O cenário central já tem implementação e teste local
  com processos separados**, em `packages/core/test/session-restart-process.test.ts`.
  A oportunidade é ampliar a matriz por harness e resultados aninhados, não criar
  um segundo mecanismo de recuperação.
- [#58763](https://github.com/anomalyco/opencode/pull/58763): sandbox para HTML/SVG
  servido na origem da API. **Já coberto** em `packages/server/src/handlers/fs.ts:80`,
  incluindo 304, ranges e HEAD. O estudo de 24/10 registra a adoção e seus limites.
- [#58410](https://github.com/anomalyco/opencode/pull/58410): camada opcional de detecção
  de credenciais na saída para modelos, com warn/mask/block. É uma proposta aberta;
  precisa ser comparada ao Vault local e às gramáticas de segredos do Hermes.
- [#58775](https://github.com/anomalyco/opencode/issues/58775): relato de regras de
  permissão dependentes da grafia do comando ou caminho. Prioridade de investigação:
  wrappers, executável absoluto, links e caminhos relativos/absolutos precisam de
  casos equivalentes. Não executei nem confirmei o bypass no Redcode.
- [#58934](https://github.com/anomalyco/opencode/issues/58934): erro de serialização
  com imagens que deixa a sessão persistentemente inutilizável;
  [#58907](https://github.com/anomalyco/opencode/issues/58907): stream interrompido
  deixa argumentos inválidos de ferramenta no histórico. São relatos distintos;
  a causa do primeiro não foi demonstrada como sendo a regex Base64.
- [#48826](https://github.com/anomalyco/opencode/issues/48826): conclusão prematura
  de filho com trabalho em background. Nossa verificação de atividade inclui
  descendentes, inbox e jobs; vale manter esses cenários na matriz de regressão.

## T3 Code

### Direção de produto acordada em 26/10/2026

- **Monitors:** usar o T3 Code como referência de comportamento, interface e integração
  com os harnesses Claude e Codex. Evoluir o serviço nativo e a inspeção Desktop já
  existentes no Redcode; comparar identidade, acompanhamento, conclusão e cancelamento
  do trabalho antes de definir as próximas mudanças.
- **Automations:** partir da implementação do T3 Code para estudar agenda, persistência,
  vínculo com conversas e worktrees, gatilhos e histórico de execuções. Adaptar esse
  comportamento à admissão durável de prompts do Redcode, mantendo explícita a diferença
  entre disparar trabalho e confirmar sua conclusão.
- **Hooks:** continuar a implementação já iniciada no Redcode, em `packages/core/src/hook.ts`,
  com API, configuração, confiança/importação e `/hooks` no TUI. A próxima etapa deve
  aproveitar essa base e avaliar sua exposição no Desktop, preservando os contratos
  existentes; hooks não são uma funcionalidade a começar do zero.

Inspeção complementar do T3 Code em 26/10, na revisão
`560ddb14d90eba7652da4f7846e4b18d4d802aa4`:

- O [adaptador Claude](https://github.com/pingdotgg/t3code/blob/560ddb14d90eba7652da4f7846e4b18d4d802aa4/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts)
  distingue Monitor de Bash pela ferramenta que iniciou a tarefa `local_bash`, preserva
  identidade e relação com a tarefa pai, e marca explicitamente tarefas aguardadas.
  Essa é a referência para ampliar a inspeção dos harnesses do Redcode; listar apenas
  monitores nativos de Session ainda não cobre esse comportamento.
- O [serviço de agenda](https://github.com/pingdotgg/t3code/blob/560ddb14d90eba7652da4f7846e4b18d4d802aa4/apps/server/src/scheduledTasks/ScheduledTaskService.ts)
  cria uma conversa ou enfileira o prompt na conversa vinculada. Nesse serviço,
  `succeeded` registra sucesso do despacho, sem comprovar o resultado do agente.
  A adaptação deve registrar admissão e resultado como fatos distintos, usando a inbox
  existente em vez de introduzir outro executor de modelos.
- O [cálculo da agenda](https://github.com/pingdotgg/t3code/blob/560ddb14d90eba7652da4f7846e4b18d4d802aa4/apps/server/src/scheduledTasks/Schedule.ts)
  diferencia intervalo decorrido e horário fixo e trata horários fixos perdidos com uma
  tolerância explícita. O Redcode começa por intervalos decorridos: depois de suspensão
  ou reinício, admite uma ocorrência vencida e calcula o próximo intervalo a partir dela,
  sem reproduzir todas as ocorrências perdidas. A agenda de calendário agora mantém
  os dias e horário em um fuso nomeado, com a mesma tolerância de dez minutos do T3 Code.
  Registra uma ocorrência antiga como perdida e calcula a próxima futura, sem admitir
  trabalho atrasado nem pausar a recorrência. Em saltos de horário de verão, desloca pelo
  tamanho do salto; em horário repetido, usa somente a primeira ocorrência.

O Desktop do Redcode agora expõe a base existente de hooks em **Delivery → Hooks**.
**Delivery → Automations** oferece agenda persistida na conversa existente, execução única,
por intervalo ou por calendário semanal, pausa, retomada, disparo manual e histórico de admissão.
Usa a inbox durável
da Session e preserva a identidade do disparo na recuperação. Admissão e conclusão do agente
permanecem fatos distintos.

**Delivery → Monitors → Linked harness tasks** acrescenta a observação persistida das tarefas
nativas do Claude e dos comandos do Codex. Mantém ID nativo, relação com a tarefa pai quando
reportada, saída e estado terminal, usando somente harnesses vinculados explicitamente em
Resources. O monitor Claude é classificado pela chamada da ferramenta Monitor, inclusive quando
essa chamada chega depois do início da tarefa. O fim de uma resposta não implica o fim de suas
tarefas; perda do processo ou reinício deixa tarefas inacabadas com estado não confirmado.

Para Codex, a referência do contrato de comandos é
[ThreadItem](https://github.com/openai/codex/blob/9526f8d0d076f950ccc108d03c53b2df22289b2d/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts).
A integração cobre eventos observados pelos processos que o Redcode possui. Não reconstrói
histórico de outros processos nem implementa o roster do T3 Code.

A ferramenta [`t3_background_wait`](https://github.com/pingdotgg/t3code/blob/560ddb14d90eba7652da4f7846e4b18d4d802aa4/apps/server/src/mcp/toolkits/orchestrator/tools.ts)
marca a intenção de aguardar tarefas, em vez de bloquear até sua conclusão. O adaptador usa essa
intenção no estado de execução da conversa. A adaptação inicial do Redcode é diferente:
`redcode_background_wait`, habilitada explicitamente ao abrir o harness, aguarda uma observação
por até trinta segundos, limitada aos IDs daquela execução. O Claude a recebe pelo MCP do SDK;
o Codex, por ferramentas dinâmicas na API experimental do app-server. A resposta distingue estado
terminal, prazo esgotado, cancelamento e observação indisponível. O estado terminal da espera não
equivale a sucesso da tarefa. O Desktop mostra o último estado e prazo da espera.

Roster, retomada de pais ociosos após conclusão nativa e webhooks continuam pendentes. A espera
ativa não é restaurada após reinício e não inicia nem encerra trabalho externo.

### Integrado upstream

- **Coalescência de atualizações substituídas:** [#24267](https://github.com/pingdotgg/t3code/pull/24267),
  commit `27e0c684c5`, remove snapshots de texto já superados dentro de uma janela
  de envio. O patch mantém fronteiras terminais, ordem dos sobreviventes e cursores.
  As reduções de bytes descritas no PR são de fixtures sintéticas upstream.
  No Redcode, `packages/client/src/shared-events.ts` distribui cada evento a cada
  assinante, e a capacidade da fila é limitada. Há uma oportunidade de medir
  coalescência de projeções substituíveis. **Deltas e eventos duráveis não podem ser
  descartados como se fossem snapshots.**
- **Pai retomado após filho nativo terminar:** [#23840](https://github.com/pingdotgg/t3code/pull/23840),
  commit `11adcb0e25`, trata o caso de um pai Codex já ocioso quando o filho nativo
  conclui. O Redcode tem entrega sintética durável para seus próprios subagentes;
  é necessário confirmar cobertura equivalente nos harnesses externos.
- **Webhooks com deduplicação e agrupamento persistidos:**
  [#22234](https://github.com/pingdotgg/t3code/pull/22234), commit `2ebe280e56`.
  A identidade de replay e a chave de agrupamento são distintas, com janela
  persistida e limite de logs. Boa referência para automações sobre nosso inbox.
  Webhooks de telemetria já existentes no README não equivalem a um motor de workflows
  disparados por webhook.
- **Segredo entregue por arquivo privado:** [#24809](https://github.com/pingdotgg/t3code/pull/24809),
  commit `e0b194021b`, atende CLIs que não aceitam referências opacas de segredo.
  O Redcode já tem Vault e substituição no executor em `vault/shell.ts`.
  Uma entrega por arquivo temporário só se justifica para ferramentas que exigem
  arquivo, com escopo, expiração e exclusão do conteúdo do histórico.
- **Colaboração humana moderada:** [#24104](https://github.com/pingdotgg/t3code/pull/24104),
  commit `fb76594d7b`, oferece link de convidado, acompanhamento ao vivo e mensagens
  que o dono aceita ou descarta. Recurso opt-in; oportunidade de produto posterior
  às garantias de autorização e replay.
- **Busca indexada de mensagens:** [#24343](https://github.com/pingdotgg/t3code/pull/24343),
  commit `bb7783e295`, combina ranking e seções estáveis para títulos e mensagens.
  Aqui, `packages/core/src/session/store.ts:230` pesquisa título por LIKE.
  Busca textual de mensagens é uma lacuna concreta da superfície examinada.

### PRs e issues abertas

- [#16719](https://github.com/pingdotgg/t3code/pull/16719): delegar para outro ambiente,
  com identidade de repositório, requisição idempotente e autoridade limitada pelo
  vínculo entre máquinas. O Redcode possui reservas e contratos de workers,
  mas isso não estabelece uma API de delegação federada completa.
- [#20145](https://github.com/pingdotgg/t3code/pull/20145): cartões de aprovação exibem
  o comando completo, além da explicação. Nosso dock mostra recursos e descrição;
  conferir o comando real de cada harness e o comportamento de truncamento é
  uma validação relevante para GUI, TUI e clientes remotos.
- [#19112](https://github.com/pingdotgg/t3code/issues/19112): SDK reexecuta ferramentas
  após falha ao salvar checkpoint de uma resposta já terminada. O contrato Redcode
  deve separar falha de persistência e nova autorização para efeitos externos.
- [#24486](https://github.com/pingdotgg/t3code/issues/24486): shadow homes compartilham
  o arquivo SQLite base mas separam WAL/SHM, com corrupção relatada.
  Não encontrei esse materializador de shadow home no recorte de harnesses local;
  é um cenário obrigatório se ampliarmos instâncias com auth overlays.
- [#21772](https://github.com/pingdotgg/t3code/issues/21772): conclusão de filho
  iniciada pelo provider não acorda o pai. Reforça a necessidade de testar callbacks
  nativos, além dos filhos criados diretamente pelo Core.

## OpenBot

### Integrado upstream

- **Trace temporal por execução:** [#3053](https://github.com/nightly-labs/openbot/pull/3053),
  commit `54ee532f46`, disponibiliza duração, ferramentas, subagentes, uso e custo
  numa linha do tempo com navegação para o chat.
  O Redcode tem o grafo Agents → Tasks; falta uma projeção temporal unificada por
  objetivo. Usar eventos operacionais e resumos públicos, sem transformar raciocínio
  privado em requisito de transparência.
- **Contexto estável e mensagens ainda não lidas:**
  [#3035](https://github.com/nightly-labs/openbot/pull/3035), commit `e83cd6d75a`.
  Mudanças de equipe deixam de invalidar todo o prefixo, e cada membro recebe o delta
  após o cursor aceito. Reinício, troca de sessão e compactação exigem reconstrução.
  Para o Redcode: contexto comum versionado por objetivo, com hash, autoria e recibo
  do contexto recebido por cada atribuição.
- **Fallback em indisponibilidade:** [#2997](https://github.com/nightly-labs/openbot/pull/2997),
  commit `6a2f3bf4eb`, amplia a classificação de falhas para acionar backups
  previamente configurados. Preservar nossa escolha explícita de contas, modelos
  e providers; indisponibilidade não autoriza ativação pelo ambiente.
- [#3033](https://github.com/nightly-labs/openbot/pull/3033) reforça a precedência das
  instruções do usuário; [#3016](https://github.com/nightly-labs/openbot/pull/3016)
  torna mensagens entre agentes visíveis; [#3027](https://github.com/nightly-labs/openbot/pull/3027)
  mostra quais agentes estão trabalhando. São complementos úteis ao painel por objetivo.

### PRs e issues abertas

- [#3062](https://github.com/nightly-labs/openbot/pull/3062): canvas de workflows com
  gatilhos, agentes, condições, aprovações, agenda, webhook assinado e versões.
  Está aberto, muda 193 arquivos e não oferece a página para mobile/web.
  Foram consultados o escopo e os primeiros cem registros de arquivos; não houve
  auditoria integral desse PR.
- [#3060](https://github.com/nightly-labs/openbot/pull/3060): aplicar troca de provider
  na próxima execução, preservando a que já está em andamento.
- [#3041](https://github.com/nightly-labs/openbot/issues/3041): coordenador continua
  atribuindo a um membro ocupado; [#3034](https://github.com/nightly-labs/openbot/issues/3034):
  canvas marca conclusão com delegado ativo. Nosso `SessionTaskAssignments.activity`
  já percorre descendentes. A UI deve refletir essa decisão do servidor.
- [#2463](https://github.com/nightly-labs/openbot/issues/2463) e
  [#2499](https://github.com/nightly-labs/openbot/issues/2499): memória desativável
  e aprendizado opt-in. Consentimento, escopo e origem devem vir antes da extração.

O [LICENSE atual](https://github.com/nightly-labs/openbot/blob/main/LICENSE) é
**PolyForm Noncommercial 1.0.0**. As oportunidades acima são referência funcional
para implementação independente no Redcode; não uma proposta de copiar o código.

## oh-my-pi

### Integrado upstream

- **Aprovações sobrevivem à reconexão:** [#16682](https://github.com/can1357/oh-my-pi/pull/16682)
  conserva perguntas pendentes e só aceita respostas do peer que continua autorizado.
  Reutilizar um identificador de peer não transfere a autoridade anterior.
  No Redcode, explorar a matriz de desconexão do dono, do cliente e de ambos,
  preservando resposta única e estado durável.
- **Memória sem raciocínio de replay:** [#16681](https://github.com/can1357/oh-my-pi/pull/16681),
  commit `b0ad97c875`, exclui thinking assinado, conteúdo redigido e providerPayload
  da entrada do extrator de memória. É um requisito para qualquer memória futura
  e exportação de resumo no Redcode.
- O main também corrige cancelamento dos jobs da sessão que está sendo deixada
  [#16760](https://github.com/can1357/oh-my-pi/pull/16760), escopo de limpeza da memória
  [#16657](https://github.com/can1357/oh-my-pi/pull/16657) e cadeia de modelos de backup
  explicitamente vazia [#16548](https://github.com/can1357/oh-my-pi/pull/16548).
  Uma lista vazia configurada pelo usuário deve conservar seu significado.

### PRs e issues abertas

- [#16953](https://github.com/can1357/oh-my-pi/pull/16953): normalização e coordenação
  dos probes de uso, com cooldown de 429/Retry-After. Relevante para evitar que
  vários clientes Redcode consultem a mesma conta ao mesmo tempo. Comparar escopo
  de conta e origem antes de introduzir locks ou persistência adicionais.
- [#16904](https://github.com/can1357/oh-my-pi/pull/16904): compactação automática
  só aceita candidatos que reduzam o contexto projetado; limita retenção em janelas
  pequenas e evita repetir sem avanço do corte. Um buffer válido isoladamente
  não garante progresso.
- [#15393](https://github.com/can1357/oh-my-pi/pull/15393): carregar instruções de
  subdiretórios no primeiro acesso. Nossa descoberta e cronologia pertencem ao
  domínio Instructions/Session; qualquer extensão precisa conservar essa propriedade,
  inclusive após compactação e movimento.
- [#15586](https://github.com/can1357/oh-my-pi/issues/15586): grep no mesmo processo
  pode derrubar locks POSIX de SQLite ao fechar outro descritor do mesmo inode.
  **O grep Redcode examinado executa rg em subprocesso**, em `ripgrep.ts:121`.
  O índice FFF usa `disableContentIndexing: true`. Esses caminhos diferem do relato;
  isso não constitui auditoria de todos os leitores de arquivos.
- [#13694](https://github.com/can1357/oh-my-pi/issues/13694): busca enviada a terceiro
  sem opt-in. Conservar a regra local de integrações explicitamente escolhidas.
- [#16868](https://github.com/can1357/oh-my-pi/issues/16868): restore relança filhos
  abandonados muitos dias antes. Recuperação Redcode deve continuar vinculada a
  ownership, admissão e contratos atuais, com cancelamento e trabalho substituído
  preservados.

## Hermes Agent

### Integrado no main

- **Política de delegação extensível:** commit
  [919322f6c3](https://github.com/NousResearch/hermes-agent/commit/919322f6c3aa2bad568a3312eb3cfbffa21db0a0)
  adiciona providers de decisão de rota por tarefa. Correções seguintes deixam uma
  rota indisponível falhar de forma explícita e registram a rota que o filho usou.
  Oportunidade: estratégias de especialidade/custo/latência sobre os contratos
  existentes, mantendo criação, execução, permissões e aceite no Core.
- **Custo de ferramenta MCP e teto por conversa:** commit
  [4baddd2606](https://github.com/NousResearch/hermes-agent/commit/4baddd2606d0e30ef9f971aa16838c6cd550b0e3)
  conta chamadas despachadas e pede aprovação ao ultrapassar o limite declarado.
  Nosso budget de objetivo e CostAssessment são a base para separar preço declarado,
  custo reportado e valor ainda desconhecido; falta a medição específica de ferramentas MCP
  na superfície examinada.
- **Plugins com capacidade e consentimento por origem:** commit
  [4ff2846110](https://github.com/NousResearch/hermes-agent/commit/4ff28461102fe4caaa9666eb47de797c4f52326b)
  impede acesso implícito ao JavaScript de previews autenticados.
  Referência para expandir extensões GUI sem tornar toda extensão dona do navegador.

### PRs e issues abertas

- [#144196](https://github.com/NousResearch/hermes-agent/pull/144196): filhos persistentes,
  fork de contexto e retomada pelo mesmo ID via plugin. Está aberto e muda 57 arquivos.
  Redcode já tem Sessions duráveis; o incremento seria um contrato explícito de
  reutilização e roteamento, respeitando a revisão atual da tarefa.
- [#136708](https://github.com/NousResearch/hermes-agent/pull/136708): resultado de filho
  pode entrar durante a execução ativa como evidência de ferramenta, com confirmação
  após persistência e fallback para fila. **Não recebe autoridade de nova mensagem humana.**
  Nosso inbox já separa queue/steer e a conclusão usa entrada sintética com origem;
  comparar a semântica de autoridade e entrega antes de ampliar a admissão.
- [#144425](https://github.com/NousResearch/hermes-agent/pull/144425): recuperação lista
  exatamente os itens incompletos de um fan-out. Boa projeção para um painel de
  reconciliação Redcode, preservando a distinção entre trabalho não concluído e
  efeitos cujo resultado é desconhecido.
- [#125000](https://github.com/NousResearch/hermes-agent/pull/125000): redação por
  gramática de arquivos de credenciais; [#144363](https://github.com/NousResearch/hermes-agent/pull/144363):
  aliases, pipelines e opções abreviadas de PowerShell em aprovações.
  São propostas abertas, não garantias publicadas de segurança.
- [#144380](https://github.com/NousResearch/hermes-agent/issues/144380): hint read-only
  em cache antes de reconectar deixa de representar a ferramenta efetivamente chamada.
  Usar metadados da conexão executora; não transformar annotation remota em autorização.
- [#141346](https://github.com/NousResearch/hermes-agent/issues/141346): aprovação
  automática de automação de aplicativo fecha documento não salvo;
  [#59293](https://github.com/NousResearch/hermes-agent/issues/59293): CLI pode alterar
  a própria política sem a proteção aplicada ao arquivo.
  Incluir identidade exata do recurso e canais de alteração de política nos testes.
  Esses relatos não foram reproduzidos no Redcode.
- [#139135](https://github.com/NousResearch/hermes-agent/issues/139135): filho terminou,
  mas a entrega persistida fica pendente e o pai não retoma. O registro de trabalho
  concluído, o de entrega e o de aceite precisam permanecer distintos.

## Base que já existe no Redcode

A comparação foi feita contra o checkout atual em `main`, base `60d5b50306`,
incluindo a correção local de credenciais ainda não publicada. Não foi feita contra
o binário instalado nem contra uma arquitetura alternativa.

- Grafo de tarefas, pré-requisitos e fingerprints de contrato em
  `session/task-graph.ts`.
- Atividade de descendentes, inbox e background jobs em `session/task-assignments.ts`.
- Recibos de validação, preparo e aplicação com pending/applied e revisão de Git em
  `session/task-integration.ts`.
- Entrega sintética persistida de resultados e teste de recuperação em outro processo.
- Core como autoridade de execução, UI Agents com DS React e clientes CLI/TUI/GUI.
- Sandbox dos documentos servidos pela API, isolamento de ferramentas MCP inválidas,
  validação do buffer de compactação e Vault no executor.

Esses componentes representam cobertura de código e de testes existentes.
Este estudo não voltou a executar esses testes, medir o produto no navegador,
instalar releases ou certificar paridade de funcionamento entre todos os clientes.

## Sequência de adoção recomendada

| Ordem               | Trabalho                                             | Escopo Redcode e critério de aceite                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 / investigação   | Permissões equivalentes e alteração de política      | Reproduções benignas de executável relativo/absoluto, env/command, links, PowerShell e alteração de config via CLI. Separar intenção do agente, comando real e decisão do servidor. Só classificar como vulnerabilidade local após evidência. |
| P0 / confiabilidade | Sessão recuperável após falha de stream/encode       | Interromper argumentos de ferramenta e variar volume de imagens. Prompts seguintes precisam continuar ou apresentar recuperação explícita, sem editar o banco manualmente nem repetir ferramentas executadas.                                 |
| P1 / lote pequeno   | Base64 linear e schemas por revisão do registro      | Mesma aceitação e pattern público; testes de limite e medição de CPU. Converter schema uma vez; mutação de hook não pode alterar outra sessão.                                                                                                |
| P1 / desempenho     | Compactação com progresso e preparação em background | Aplicar apenas resumo ligado ao contexto/epoch válido; conservar cauda e instruções. Contabilizar chamadas extras; impedir loops sem avanço e permitir cancelamento. Medir pausa P50/P95.                                                     |
| P1 / desempenho     | Streaming e clientes lentos                          | Medir bytes, alocações e latência de teclado no TUI/GUI. Coalescer somente projeções substituíveis; preservar cursores, eventos terminais, aprovações e deltas.                                                                               |
| P1 / coordenação    | Contexto comum versionado e barreira de convergência | Cada atribuição informa objetivo/contrato/contexto recebido. Esperar o grupo de contribuições necessário; invalidar só dependências afetadas. Reusar recibos e aplicação de integração existentes.                                            |
| P1 / transparência  | Trace por objetivo no Agents                         | Mostrar fila, execução, espera por provider/aprovação/dependência, revisão e aplicação, com duração, modelo, uso, custo conhecido/desconhecido e links para a evidência. Resumos públicos; sem expor raciocínio privado.                      |
| P1 / custo          | Probes de uso e ferramentas tarifadas                | Consultas por conta/origem, cooldown de 429 e custo de MCP declarado separado do observado. Incorporar no budget sem inferir custo zero para uso não medido.                                                                                  |
| P2 / automação      | Workflows e webhooks                                 | Gatilhos assinados com recibo de admissão, dedupe e coalescência persistidos; execução sobre Task/Session, com revisão e autorização. Não introduzir outro scheduler de modelos.                                                              |
| P2 / produto        | Busca de conteúdo, colaboração e memória opt-in      | Busca indexada de mensagens; convidados mediados pelo dono; memória por projeto com proveniência, controle humano e exclusão de raciocínio de replay.                                                                                         |

O primeiro lote de implementação recomendado reúne Base64/schemas com as reproduções
de sessão irrecuperável e permissões. O segundo trabalha contexto/streaming e a visão
por objetivo. Workflows, colaboração e memória avançam depois, sobre os mesmos contratos.

A identidade Redcode permanece na arquitetura única atual, no DS React, em contas
explicitamente selecionadas e na reconciliação verificável das contribuições.
Nenhum código de runtime, provider, serviço, credencial ou sessão do usuário foi alterado
por este levantamento. Os sete arquivos da correção de segurança anterior foram preservados.
