# Harness: OpenCode, Hermes e oportunidades para o Redcode

Consulta ao vivo em **26/10/2026, 12:25 UTC / 09:25 de São Paulo**. O maior ganho
imediato é melhorar concorrência de credenciais, consumo de memória e a distinção
entre uma resposta pronta e um objetivo concluído. O Redcode já tem a estrutura
durável de objetivos, tarefas, delegações e reconciliação necessária para isso.

## Base e limites

| Repositório  | Branch consultada | HEAD fixado                                |
| ------------ | ----------------- | ------------------------------------------ |
| OpenCode     | `dev`             | `ed74ec82ce1fe3a36da6c0815a935473ef4bb0fb` |
| Hermes Agent | `main`            | `9b904dcc22c23fe8b82834339bbdd96495072e59` |
| Redcode      | `main`, 0.86.0    | `93a8120d08c99b04fb5d3026d0c4498ca82bdb7d` |

Foram consultados os 60 commits recentes de cada upstream, buscas temáticas de
19 a 26/10, e PRs/issues abertos com atividade nessa janela. A inspeção focada
selecionou 13 commits, seis PRs e quatro issues para confronto com o código local.
Os 13 commits foram confirmados como ancestrais dos HEADs acima; os seis PRs
continuavam abertos. Não é um censo de todos os commits da semana nem uma revisão
integral dos PRs grandes. Datas de commits podem ter sido preservadas em merges.

[Evidências e referências fixadas](harness-upstream-2026-10-26.json).
Metadados não incluem corpos, comentários, patches nem identidades de usuários.
Conteúdo upstream foi tratado como entrada não confiável. O conector GitHub foi
usado para código, PRs e issues; a API via `gh` complementou a resolução dos HEADs.

As conclusões locais são de inspeção estática. Este estudo não executou providers,
benchmarks, testes de falhas ou jornadas de navegador, nem demonstra que os bugs
relatados upstream se reproduzem aqui. Não altera o harness ou o servidor instalado.

## Mudanças integradas e aplicação local

### 1. Renovação OAuth compartilhada — prioridade alta

O OpenCode integrou [#54023](https://github.com/anomalyco/opencode/pull/54023),
commit `94353780cf28`: chamadas simultâneas compartilham o resultado da renovação,
inclusive falhas, por identidade da credencial. Um lock de arquivo coordena outros
processos com o mesmo banco. O código relê a credencial após adquirir o lock e o
cancelamento do primeiro solicitante não mata a operação compartilhada.

No Redcode, `packages/core/src/integration.ts`, em `connection.resolve`, lê o OAuth,
verifica a expiração, chama `refresh` e grava o resultado sem essa coordenação.
`authorize` apenas transforma erros; `Credential` não oferece o lock correspondente.
É uma lacuna concreta no código: duas Sessions/Locations podem renovar o mesmo
refresh token. Uma falha real depende da política de rotação do provider.

**Adaptação:** coordenação por credencial no serviço global existente, lock local
entre processos, releitura dentro do lock e timeout. Conservar conta selecionada,
remoção da credencial e tratamento explícito de falhas. Não descobrir conexões nem
ativar providers por variáveis de ambiente.

**Aceite:** duas Locations e dois processos compartilham uma renovação; cancelar
um solicitante preserva o outro; falha compartilhada permite tentativa posterior;
credencial removida não é recriada pela conclusão de uma renovação antiga.

### 2. Memória e responsividade — prioridade alta

O OpenCode integrou três melhorias complementares:

- [#58820](https://github.com/anomalyco/opencode/pull/58820), `787811f68460`:
  processamento Photon em worker, descarte da instância ociosa e substituição após
  falha de WASM. A liberação de objetos individuais não reduz necessariamente o
  heap de WASM já crescido.
- [#59098](https://github.com/anomalyco/opencode/pull/59098), `91b5a7c25d0b`:
  ferramentas demoradas deixam de reter o evento completo do hook de request,
  que pode conter uma cópia anterior à redução das imagens.
- [#59091](https://github.com/anomalyco/opencode/pull/59091), `2903845bf28f`:
  estimativa reaproveitada no Step e consulta estreita das mensagens sintéticas,
  evitando carregar todo o histórico só para deduplicar instruções.

Aqui, `image/photon.ts` executa decode/resize no processo do servidor;
`session/model-request.ts` retorna `event: shaped`, e `runner/llm.ts` mantém o
objeto preparado durante a execução. `session/instructions.ts` ainda usa
`store.context` para obter mensagens sintéticas. Nosso runner já reaproveita o
contexto inicialmente preparado: a oportunidade é eliminar leituras e retenções
auxiliares, preservando a atualização de contexto nas continuações e retries.

**Aceite:** medir latência do loop e memória com imagens grandes e ferramentas
lentas; verificar cancelamento, crash do worker e caminho sem worker; comprovar o
comportamento no executável empacotado. A segunda entrada do worker precisa entrar
nos builds de cada plataforma. Nenhum ganho percentual é afirmado sem medição local.

### 3. Compactação preparada: eficiência e explicação — prioridade média

O Hermes integrou compactação preparada opt-in e correções para aproveitar um
resumo mesmo quando o cálculo posterior muda o início da cauda:
[`765933299d88`](https://github.com/NousResearch/hermes-agent/commit/765933299d885e850390ed1d8e4fd4d37fae8342).
Também passou a registrar início, conclusão, uso, descarte e motivos de espera ou
cancelamento em
[`4501b3f80b56`](https://github.com/NousResearch/hermes-agent/commit/4501b3f80b560251405b25d849bb7072160dee9e).

O Redcode **já tem** compactação em background em `session/compaction.ts`.
Ela mantém o resumo fora do histórico até o commit, confere fingerprint e preserva
mensagens novas. O fingerprint inclui instruções, mensagens completas cobertas e
restrições do Vault; a adoção recusa uma cauda que excedeu o limite previsto.

O incremento útil é mostrar quantos resumos foram usados ou descartados, por quê,
quanto custaram e quanto tempo a execução esperou. Depois, medir se fingerprints
ou descartes conservadores causam trabalho repetido significativo. O Hermes aceita
reescritas de texto com a mesma identidade durável; não copiar essa regra sem
preservar nossas garantias de instruções e conteúdo restrito.

**Aceite:** um resumo preparado tem desfecho observável, custo contado uma vez e
motivo fechado de descarte; mudança de instruções/Vault, revert e cancelamento
invalidam o candidato apropriado. A projeção explica os dados sem duplicar fatos
duráveis deriváveis do histórico.

### 4. Custo de ferramentas MCP — prioridade média

O Hermes integrou
[`4baddd2606d0`](https://github.com/NousResearch/hermes-agent/commit/4baddd2606d0e30ef9f971aa16838c6cd550b0e3):
preço declarado por ferramenta, unidade e teto por conversa. Uma chamada que
ultrapassa o teto exige aprovação; execução desatendida recusa antes do despacho.

O Redcode já tem budgets e proveniência de custo de modelos, mas não encontrei
preço/teto de ferramenta nos caminhos examinados de configuração e execução MCP
(`config/plugin/mcp.ts`, `schema/config/mcp.ts`, `tool/mcp.ts`).

**Adaptação:** integrar ao budget existente com unidade explícita; distinguir preço
declarado, valor reportado e desconhecido. Créditos de um serviço não são USD.
Despacho com resultado incerto precisa de reconciliação, sem reembolso ou replay
automáticos presumindo que o servidor não executou.

### 5. Cache com duração configurável — prioridade média

O OpenCode integrou [#59157](https://github.com/anomalyco/opencode/pull/59157),
`9007700546e5`: TTL em formato de duração, configuração por provider/modelo e
tradução para os protocolos suportados, incluindo retenção no nível do request.

O Redcode já tem política de cache e `ttlSeconds` na camada AI. A oportunidade é
completar a configuração explícita e a tradução por protocolo. Não é adicionar
cache do zero. O aceite deve conferir o payload real de cada protocolo, preservar
as fronteiras automáticas e medir custo de escrita/leitura junto à taxa de acerto.

## PRs abertos: referências de desenho

| Proposta upstream                                                                                                              | Comparação com o Redcode                                                                                           | Próxima ação                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode [#59258](https://github.com/anomalyco/opencode/pull/59258): notificar conclusão depois dos filhos                     | GUI/TUI locais ainda notificam em `session.execution.succeeded`; o aceite de objetivo já tem barreiras mais fortes | Distinguir resposta pronta, delegações em curso e objetivo concluído. Usar projeção do servidor, sem criar novo fato durável para estado derivado |
| OpenCode [#59262](https://github.com/anomalyco/opencode/pull/59262): `/goal`, revisão e continuação                            | Já temos objetivo persistido, orçamento, revisão e barreiras de tarefas/aplicação                                  | Aproveitar cenários de UX/testes; preservar nossa autoridade no Core e contratos atuais                                                           |
| Hermes [#145007](https://github.com/NousResearch/hermes-agent/pull/145007): Stop/resume com versão observada e recibo          | Temos coordenação, ownership e interrupção; isso não comprova cada corrida de controle                             | Exercitar Stop novo contra resume atrasado, perda da resposta e morte/reutilização de PID                                                         |
| Hermes [#142162](https://github.com/NousResearch/hermes-agent/pull/142162): isolamento solicitado é obrigatório                | Session filha não implica checkout isolado; slots locais e worktrees têm contratos próprios                        | Se oferecermos isolamento por delegação, falhar antes da execução quando indisponível. Worktree não é sandbox de processos                        |
| Hermes [#144196](https://github.com/NousResearch/hermes-agent/pull/144196): subagentes persistentes e fork filtrado via plugin | Reutilizamos Sessions filhas e validamos parentesco/contrato; não falta persistência básica                        | Avaliar observação limitada e contexto herdado por seleção, com conta e permissões revalidadas na retomada                                        |
| Hermes [#136708](https://github.com/NousResearch/hermes-agent/pull/136708): resultado assíncrono no fluxo ativo                | Já há entrega sintética durável com origem e identidade, separada do texto humano                                  | Comparar latência e autoridade. Manter admissão/entrega próprias, sem reescrever ferramenta antiga ou promover saída de filho a instrução humana  |

O novo `/goal` upstream ainda depende de outros PRs e declara limites ausentes,
como orçamento de tokens e detecção de estagnação. O Redcode já tem `SessionGoal`,
`SessionGoalCompletion`, `SessionTaskAssignments`, `SessionTaskContext`, integração
verificada e `SessionLoopGuard`. Não recomendo criar outro loop de objetivos.

## Recuperação, segurança e relatos para regressão

- O Hermes corrigiu entregas admitidas antes do reinício que ficavam atrás de
  mensagens humanas na fila:
  [`05d7b5af1c42`](https://github.com/NousResearch/hermes-agent/commit/05d7b5af1c42d524762c7ffce991c1fe1aa2adb1).
  Aqui a admissão já é durável e a recuperação separa execução, entrega e aceite.
  Acrescentar o cenário de filho concluído durante shutdown, seguido de mensagens
  e nova interrupção, sem duplicar a entrega ou ressuscitar trabalho cancelado.
- O Hermes corrigiu o caminho de providers auxiliares que ainda lia plugins do
  home em safe mode, `5e8f892657bf`, e isolou dados de providers por home/perfil.
  Usar esses casos ao avaliar isolamento de workers e extensões. Não foi demonstrada
  uma exposição equivalente no Redcode.
- Hermes `3ae67dc3d6fb` mudou Stop para preservar filhos em background; `/stop`
  continua encerrando-os. É uma escolha de produto. Nosso contrato de interrupção
  da cadeia ativa precisa permanecer explícito e uniforme entre CLI, TUI e GUI.
  Não copiar a mudança silenciosamente.
- Hermes `70d31a5a5da7` corrigiu atribuição de requests humanos em retries;
  `5e8639accd20` removeu seleção de provider pelo nome do binário externo. São
  referências para preservar identidade da conexão, executor e tentativa física,
  sem alterar a atribuição de cobrança de um provider por regra genérica.
- OpenCode [#59247](https://github.com/anomalyco/opencode/issues/59247) relata
  perda de aprovação pendente e ausência de registro após crash no meio da ferramenta.
  Nosso runner publica chamada antes da execução e registra claims de recuperação;
  ampliar testes de crash. Persistência não garante efeito externo exatamente uma vez.
- OpenCode [#59253](https://github.com/anomalyco/opencode/issues/59253) relata
  compactação sem resumo; Hermes [#145022](https://github.com/NousResearch/hermes-agent/issues/145022)
  relata workers perdidos sob bloqueio do gateway. São relatos abertos, sem causa
  local confirmada. Usar como cenários de carga e recuperação, não como bugs locais.
- Hermes [#99743](https://github.com/NousResearch/hermes-agent/issues/99743) pede
  detecção de chamadas repetidas. Já temos detector, correção/parada e registro de
  intervenções; o trabalho útil é verificar cobertura entre ferramentas e clientes.

## Sequência de implementação recomendada

1. **OAuth concorrente:** correção localizada em Credential/Integration e testes
   reais de concorrência entre Locations/processos.
2. **Memória do Step:** soltar o evento do hook e estreitar leituras de instruções;
   medir o caminho com anexos. Depois isolar Photon e validar os builds empacotados.
3. **Semântica de conclusão:** read model do servidor e notificações coerentes em
   GUI/TUI/CLI; prova com pai respondendo enquanto filhos continuam ativos.
4. **Matriz de recuperação e controles:** cancelamento, resume atrasado, reinício
   e entrega de filho com recibos/ownership existentes.
5. **Compactação observável:** uso/descarte/espera/custo, seguido de otimização
   orientada por medições e preservando os fingerprints necessários.
6. **Cache e MCP:** duas entregas separadas sobre configuração e budgets atuais;
   sem descoberta automática de providers ou serviços.

Cada entrega deve manter as dependências Schema → Core/Protocol → Server e os
clientes como consumidores da autoridade do servidor. Alterações de API pública
exigem geração oficial do cliente; mudanças de produto exigem Changeset. Este
estudo só adiciona documentação e evidências, sem commit, push ou nova publicação.

O primeiro lote posteriormente autorizado tem implementação e validação descritas
em [harness-adoption-2026-10-26.md](harness-adoption-2026-10-26.md).
