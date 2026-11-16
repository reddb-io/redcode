# Metodologia de migração seletiva para Rust

Esta metodologia transforma a investigação de performance do RedCode em ciclos
repetíveis: identificar uma oportunidade, construir uma PoC, provar equivalência
e ganho, observar o novo caminho em shadow mode, promovê-lo gradualmente, desligar
o antigo e somente depois iniciar sua remoção. Ela vale para backend, componentes
compartilhados e hotspots do desktop ou web que tenham uma fronteira adequada.

O programa não considera todo TypeScript como legado. **Legado**, neste documento,
é uma implementação que já possui uma substituta aprovada para o mesmo contrato.
Código de UI, orquestração ou integração que continua sendo a implementação certa
permanece no produto. A definição de concluído é: todo módulo admitido no programa
foi rejeitado com evidência ou chegou ao novo caminho exclusivo; nenhum caminho
substituído é instanciado, chamado ou distribuído; então começa sua deleção.

## Regras do programa

1. Evidência escolhe o módulo. Uma reescrita não começa apenas porque a fronteira
   parece conveniente ou porque Rust tende a usar menos memória.
2. O contrato vem antes da PoC. Entradas, saídas, ordenação, erros, cancelamento,
   efeitos, ownership e plataformas suportadas são registrados antes da medição.
3. O baseline é imutável durante a comparação. Revisão, fixture, binários, opções,
   máquina e scripts recebem identidade ou hash.
4. O ganho precisa existir de ponta a ponta. Conversões, FFI/WASM/IPC, inicialização,
   atualização, descarte e trabalho de fundo fazem parte do custo.
5. Uma única fronteira decide entre as implementações. Consumidores não conhecem
   `legacy` ou `rust`; eles dependem do contrato estável do módulo.
6. Shadow mode nunca duplica efeitos externos. Escritas usam replay isolado ou
   validação offline; somente operações puras ou de leitura podem executar em par.
7. Um módulo por vez fica em migração produtiva. Podemos pesquisar o seguinte,
   mas não iniciar outro rollout antes de o atual chegar a `LEGACY_OFF`.
8. O caminho antigo não inicializa recursos quando está desligado. Zero chamadas
   com um índice antigo ainda residente em memória não conta como migração.
9. Resultados negativos são entregas válidas. Uma PoC reprovada vira evidência e
   impede que a mesma hipótese seja repetida sem um fato novo.
10. Apagar é uma fase própria. Primeiro convergimos todos os módulos admitidos para
    uso exclusivo do novo caminho; depois removemos código, flags e dependências.

## Estados e portões

| Estado         | O que existe                                         | Portão para avançar                                     |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `OBSERVED`     | Perfil ou incidente reproduzível                     | Custo atribuído a um módulo e cenário real definido     |
| `BASELINED`    | Contrato, fixtures e números do caminho atual        | Baseline reproduzível e orçamento escrito antes da PoC  |
| `POC`          | Implementação isolada, fora do padrão do produto     | Compila, libera recursos e executa o mesmo corpus       |
| `VALIDATED`    | Comparação funcional e de recursos                   | Contrato obrigatório aprovado e meta de ganho alcançada |
| `SHADOW`       | Antigo responde; novo executa de forma amostrada     | Divergências dentro do orçamento, sem afetar o usuário  |
| `CANARY`       | Novo responde para uma coorte; antigo é fallback     | Metas sustentadas em carga real e fallback controlado   |
| `PRIMARY`      | Novo é o padrão; antigo só atende rollback explícito | Cobertura das superfícies e plataformas suportadas      |
| `LEGACY_OFF`   | Antigo não é carregado nem chamado                   | Janela de estabilidade e uso antigo igual a zero        |
| `DELETE_READY` | Dependências do antigo estão isoladas                | Auditoria de referências, artefatos e rollback aprovada |
| `DELETED`      | Código, flag, dependência e build antigo removidos   | CI, pacote, benchmarks e soak aprovados sem o legado    |
| `REJECTED`     | Hipótese ou implementação arquivada                  | Motivo, dados e condição para reabrir registrados       |

Um estado é evidência, não uma porcentagem de implementação. O ledger só muda
quando os artefatos do portão existem. Falha funcional, corrupção, crash, efeito
duplicado ou regressão acima do orçamento retorna o módulo ao estado anterior.

### Decisão determinística

Cada ficha fixa antes da comparação o contrato, os limites de desempenho, os
cenários e as plataformas aos quais a decisão se aplica. Ao concluir a execução,
registre uma das decisões: **aprovado**, **reprovado** ou **inconclusivo**.
Teste reprovado reprova o candidato; teste ausente ou medição inválida torna a
decisão inconclusiva. Nenhum dos dois deve ser apresentado como aprovado.

Quando todos os critérios definidos para a promoção estiverem aprovados, promova
imediatamente a implementação para o caminho canônico daquela abrangência, com
os testes e o empacotamento correspondentes. Não acrescente outra rodada de
investigação nem exija autorização adicional para essa promoção. Mantenha apenas
o rollback previsto e avance para a próxima oportunidade. Shadow ou canary são
usados quando previamente necessários para observar o comportamento em uso; não
são etapas repetidas depois de já terem cumprido seus critérios. A remoção física
do código substituído continua na fase de deleção combinada para o programa.

Uma reprovação encerra aquela variante com os números e a razão registrados;
uma nova tentativa exige uma hipótese concreta de correção. Um resultado
inconclusivo registra exatamente o teste faltante ou a medição inválida. Não
amplie o escopo de uma decisão após conhecer os resultados para postergar uma
promoção que já satisfez os critérios previamente definidos.

## Ciclo de um módulo

### 1. Identificar e priorizar

O módulo precisa aparecer em profiling, retenção observada, long task, latência de
cauda ou custo de CPU relevante. Para ordenar candidatos, damos notas de 0 a 5:

```text
prioridade = 2 × impacto + 2 × confiança_da_atribuição + isolamento + reutilização
             - risco_de_paridade - custo_de_distribuição
```

A nota apenas ordena investigações; não autoriza uma reescrita. A ficha registra:

- jornada afetada e processo responsável: server, renderer, worker, main, GPU ou
  filho externo;
- percentual ou quantidade absoluta atribuída ao módulo;
- fronteira de dados e consumidores;
- comportamento já implementado nativamente por Git, ripgrep, SQLite ou outra
  dependência, para não reescrever apenas o wrapper;
- hipótese de ganho e alternativa mais barata em TypeScript;
- riscos de plataforma, licenciamento, distribuição e recuperação.

### 2. Fixar contrato, baseline e orçamento

O baseline contém pelo menos três tamanhos de entrada, casos vazios e inválidos,
Unicode, cancelamento, inicialização fria/quente, atualização, idle e descarte.
Quando retenção tardia fizer parte do incidente, inclui soak proporcional — no
caso já observado no desktop, de quatro a oito horas.

Cada módulo declara antes da PoC:

- invariantes obrigatórios, que exigem 100% de aprovação;
- divergências intencionais de relevância ou representação e como normalizá-las;
- métrica alvo e cenário representativo;
- métricas protegidas que não podem piorar;
- amostras, ambientes, limites e regra estatística;
- condição de abandono.

O critério inicial padrão é melhorar pelo menos 20% no p95 **ou** 25% no pico de
memória do cenário alvo, sem regressão funcional nem piora material no caminho
comum. “Material” começa em 5% para latência, CPU ou memória, mas cada ficha pode
definir um limite mais apropriado antes de medir. Medimos mediana e dispersão de
ao menos cinco processos novos por combinação; não executamos build ou typecheck
em paralelo com benchmarks.

Para CPU usamos tempo de processo, incluindo threads nativos e filhos quando eles
pertencem à operação. Para memória registramos heap JS, memória nativa/WASM,
working set/RSS, private committed, pico e valor após fechar recursos. Também
medimos p50/p95/p99, atraso do event loop ou long tasks, cold start, throughput,
CPU ociosa e bytes copiados na fronteira.

### 3. Construir a PoC

A PoC começa fora da seleção padrão e não altera o lockfile ou o empacotamento de
produção sem necessidade. Ela deve tornar explícitos:

- ownership e momento de liberação;
- formato de lote na fronteira, evitando chamadas FFI por item;
- comportamento diante de panic, exceção, input inválido e binário ausente;
- thread, worker ou fila que impede computação longa no event loop;
- cancelamento e deadline;
- matriz de plataformas e arquiteturas;
- licença, lockfile, proveniência e hash do binário medido.

A comparação inclui três caminhos quando viável: implementação atual, melhoria
equivalente em TypeScript e Rust. Se Rust ganha apenas no kernel, mas perde depois
de serialização, cópia ou inicialização, a PoC é rejeitada ou redesenhada.

### 4. Validar fora de produção

Executamos o mesmo corpus nos dois caminhos e classificamos diferenças como:

- `hard`: resultado incorreto, ausência, erro, crash, efeito ou violação de ordem
  que pertence ao contrato;
- `soft`: ranking ou representação diferente, dentro de uma tolerância definida;
- `expected`: diferença aprovada e coberta por teste;
- `measurement`: variação de ambiente, sem diferença semântica.

O módulo só chega a `VALIDATED` quando não há divergência `hard`, as metas de
performance passam, o descarte não deixa crescimento não explicado, e build,
testes, empacotamento experimental e fallback foram exercitados. Os testes de
contrato permanecem independentes da implementação para sobreviver à deleção.

### 5. Integrar uma chave de execução

O adapter expõe um modo com semântica única:

```text
legacy  -> somente antigo
shadow  -> antigo responde; novo compara e é descartado
canary  -> novo responde para coorte estável; antigo atende fallback
rust    -> somente novo; falha é visível ou segue política explícita
```

A escolha é estável por projeto ou sessão para evitar alternância dentro da mesma
jornada. A chave tem default, origem e expiração documentados. Uma falha de carga
do binário nunca pode virar resposta vazia ou sucesso aparente.

### 6. Operar shadow mode

Shadow mode é uma fase de correção sob carga real, não um benchmark limpo. Suas
regras são:

- amostragem determinística e inicialmente pequena;
- prioridade baixa, deadline curto, concorrência e memória limitadas;
- descarte imediato quando houver pressão de CPU, RAM ou event loop;
- nenhum segundo write, envio de rede, evento durável ou mutação de filesystem;
- comparação após normalização do contrato;
- métricas agregadas por categoria, sem guardar conteúdo, paths, prompts ou
  segredos do usuário;
- custo do shadow medido separadamente, preferencialmente por coortes A/B, porque
  manter dois índices no mesmo processo distorce RSS.

Para operações com efeitos, capturamos a entrada já autorizada e a reproduzimos em
fixture isolada ou em CI; não executamos o novo efeito em produção. O antigo segue
sendo a autoridade até o fim de `SHADOW`.

A ficha define volume e tempo mínimos antes do rollout. O padrão é cobrir pelo
menos mil operações válidas, reinicializações e um ciclo completo de abrir/usar/
fechar recursos em cada plataforma suportada. Exigimos zero divergência `hard`;
divergências `soft`, quedas do shadow e overhead obedecem ao orçamento do módulo.

### 7. Canary e promoção

O canary sobe por coortes estáveis, normalmente 1%, 5%, 25%, 50% e 100%. Cada
degrau precisa acumular a amostra e a janela definidas pela ficha, incluindo cold
start e descarte. Erro, crash, fallback, p95/p99, CPU, RSS/pico, idle e diferença
funcional são observados por modo e plataforma.

Rollback é automático para violações duras e manual para tendências ainda não
conclusivas. Ele troca a seleção na fronteira; não exige mudar consumidores nem
reiniciar migrações de dados. Quando o novo caminho depende de estado com formato
próprio, ele deve reconstruí-lo ou versioná-lo — nunca fazer o antigo ler bytes que
não entende.

Em `PRIMARY`, Rust é o default e o antigo só pode ser escolhido por uma chave de
emergência. Ao entrar em `LEGACY_OFF`, removemos o fallback automático, impedimos
a inicialização do antigo e instrumentamos tentativas de uso. A chave de emergência
tem prazo e responsável; não pode se tornar configuração permanente.

### 8. Selar e seguir para o próximo módulo

Um módulo só libera o próximo rollout depois de:

- todas as superfícies previstas selecionarem o novo caminho por padrão;
- fallback, chamadas e inicializações antigas permanecerem em zero durante a
  janela definida;
- memória e CPU de idle voltarem ao orçamento após fechar projetos/sessões;
- pacote instalado conter o binário correto e não depender do artefato antigo;
- testes provarem que `rust` não importa nem constrói o legado;
- rollback da release e procedimento de suporte estarem documentados.

Nesse ponto o módulo fica `LEGACY_OFF`. Seu código antigo permanece em quarentena:
uma pasta ou adapter claramente delimitado, sem novos consumidores, com CI contra
novas referências. Começamos então o ciclo do próximo desafio.

## Campanha final de deleção

A campanha começa quando não há item em `OBSERVED` até `PRIMARY`: todos os módulos
admitidos estão `LEGACY_OFF`, `DELETE_READY`, `DELETED` ou `REJECTED`, e o ledger
mostra uso antigo zero. Antes da primeira remoção, congelamos a revisão e mapeamos
dependências entre legados. A ordem é das folhas para as raízes.

Para cada módulo:

1. remover implementation, fallback, flag, configuração, telemetria temporária e
   testes exclusivos do caminho antigo;
2. remover dependências npm, DLLs, downloads, scripts, licenças e passos de build
   que ficaram sem consumidores;
3. manter testes de contrato, diferenciais que ainda agreguem valor e benchmarks
   do novo caminho;
4. procurar referências textuais, imports dinâmicos, seletores de runtime,
   artefatos empacotados e documentação;
5. executar CI, matriz de pacotes instalados, benchmark representativo e soak;
6. registrar redução de código, bundle/pacote, CPU e memória frente ao baseline;
7. marcar `DELETED` somente depois de validar uma instalação limpa e um upgrade.

Depois da deleção, rollback significa voltar para uma release anterior. Não
mantemos código morto na release atual para uma recuperação hipotética.

## Artefatos obrigatórios

Cada módulo mantém uma ficha versionada em `docs/performance/migrations/<id>.md`.
Dados brutos grandes ficam fora do Git; a ficha registra caminho, hash e comando.

```markdown
# <ID> — <módulo>

- Estado:
- Responsável:
- Revisão e plataformas:
- Jornada/processo:
- Contrato e consumidores:
- Evidência do gargalo:
- Alternativa TypeScript avaliada:
- Hipótese e orçamento definidos antes da PoC:
- Fixtures e casos de erro:
- Implementações comparadas:
- Resultado funcional:
- CPU, memória, latência e idle:
- Política de shadow e privacidade:
- Amostra/janela por degrau:
- Fallback e rollback:
- Dependências/artefatos legados:
- Decisão, riscos e próximo portão:
```

O ledger deste documento é a visão do programa; a ficha é a fonte de evidência do
módulo. Não duplicamos números manualmente em dashboards sem apontar para a ficha.

## Ledger inicial

| ID          | Fronteira                             | Estado     | Evidência atual                                                                                                     | Próximo portão                                                                                                                 |
| ----------- | ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FS-001`    | Índice e ranking de nomes de arquivos | `REJECTED` | Variantes medidas reprovadas; busca existente voltou ao padrão, Rust exige opt-in | Reabrir apenas com hipótese concreta para ranking e desempenho |
| `PATCH-002` | Parsing e normalização de patches     | `REJECTED` | No teto de 10 MB, alternativa TS removeu ~9,4 MiB da contagem; operações restantes ficaram em 27–37 ms e não aparecem em profile real | Reabrir somente com custo material atribuído em produção                                                                       |
| `MD-003`    | Projeção incremental de Markdown      | `REJECTED` | Alternativa TS reduziu 100 KB/391 deltas de 4.925 para 36 ms e RSS incremental de 18,8 para 9,1 MiB; diferencial aprovado | Reabrir somente se parser da cauda, Shiki ou DOM aparecerem em profile real                                                     |
| `EVENT-004` | Serialização de eventos/histórico     | `REJECTED` | Sem custo atribuído; encoding desnecessário com `persist=false` foi removido em TS e 53 testes do Bus passaram       | Reabrir somente se tracing separar encoding de SQLite/projectors em carga persistente                                           |
| `BROWSER-005` | Retenção do console no desktop | `REJECTED` | Limpeza do Chromium via CDP já implementada; regressão passou com Chromium real | Medir o restante do consumo por processo em desktop empacotado |
| `LOCATION-006` | Ativação de serviços de projeto | `OBSERVED` | Projetos adicionais retiveram cerca de 10 MiB cada; a janela de ativação agrega vários plugins | Atribuir o custo a componentes antes de admitir uma PoC Rust |
| `AZURE-007` | Detecção do Azure CLI por projeto | `REJECTED` | `Bun.which` mais rápido para CLI ausente, mas não detectou `az.cmd` no teste | Reabrir com uma alternativa que preserve resolução Windows e demonstre ganho |
| `AGENT-TOOLS-008` | Detecção de executáveis de ferramentas | `REJECTED` | Alternativa TypeScript eliminou 40 buscas de Node na fixture; integração preservada | Reabrir somente com perfil que justifique reescrita |
| `TOOL-SCHEMA-009` | Conversão de schemas de ferramentas | `REJECTED` | Cache TypeScript no caminho padrão reduziu 31% do tempo na fixture; 84 testes passaram | Reabrir Rust só com perfil que justifique nova fronteira |
| `MARKDOWN-CACHE-010` | Cache de Markdown do renderer | `REJECTED` | Alternativa TS limitou cache e reduziu heap sintético de 25,03 para 15,91 MiB; preload e abertura testados | Reabrir Rust somente com nova evidência de custo |

`FS-001` é o único ciclo produtivo ativo. Os demais formam uma fila de investigação,
não um compromisso de reescrita. Session runner, Effect, servidor HTTP completo e
substituição do Electron ficam fora do programa até surgir evidência que justifique
reavaliar suas fronteiras e o custo de plataforma.
