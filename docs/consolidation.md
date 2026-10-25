# Consolidação do Redcode

O Core, os contratos e os clientes atuais formam a única estrutura de execução.
Versões exigidas por protocolos externos, formatos persistidos e registros de
release permanecem explícitas; nomes de gerações anteriores não definem caminhos
alternativos de execução.

## Decisões de produto

- Conversão de dados antigos exige ação explícita, com inspeção anterior e saída
  em um destino novo. A origem é preservada e uma saída existente não é sobrescrita.
- A consolidação da GUI usa React e o Design System oficial por jornadas completas.
- Arquivamento exige ausência de execução e trabalho pendente, incluindo filhos.
  Restaurar não inicia execução; arquivar não cancela nem apaga trabalho.
- Providers dependem de conexões e referências escolhidas explicitamente.

## Execução do plano aprovado

- [x] Retirar conversões automáticas de configuração, preferências, temas e startup.
- [x] Entregar inspeção e conversão explícitas de configuração, histórico, tema e display.
- [x] Conectar configuração e LSP às APIs existentes, com erros e escopo corretos.
- [x] Entregar arquivamento/restauração pelo mesmo contrato em CLI, TUI e GUI.
- [x] Consolidar conexão/configuração, conversa, aprovações, histórico, Agents e Design por jornadas.
- [x] Registrar cobertura por superfície e automatizar jornadas e smoke nativo no CI.
- [x] Registrar baselines reproduzíveis de abertura, troca de sessão, streaming e memória.

Cada conclusão deve apontar o teste proprietário e a evidência do commit.
Validação de uma interface com respostas controladas não comprova o backend;
testes de domínio e HTTP continuam responsáveis por autorização, persistência e
recuperação. O CI deve também exercitar jornadas contra um servidor local real.

## Conversão explícita

`redcode migrate inspect <source> --kind <kind> --json` inspeciona sem publicar
arquivos. `redcode migrate convert <source> --kind <kind> --output <path>` publica
somente uma saída nova. Os tipos são `config`, `history`, `theme` e `display`.
Executar uma conversão não executa prompts nem descobre providers.

O comando de inspeção não imprime o conteúdo dos arquivos. Incompatibilidades
precisam ser resolvidas antes de publicar uma conversão. A origem preservada é a
cópia de recuperação; o conversor não faz atualizações no arquivo original.

```sh
redcode migrate inspect ./old-config.jsonc --kind config --json
redcode migrate convert ./old-config.jsonc --kind config --output ./current-config.json
redcode migrate convert ./agents/reviewer.md --kind config --output ./reviewer-config.json
redcode migrate convert ./old-history.db --kind history --output ./current-history.db
redcode migrate convert ./old-theme.json --kind theme --output ./current-theme.json
redcode migrate convert ./cli.json --kind display --output ./current-cli.json
```

Agentes Markdown são convertidos em um documento JSON de configuração atual. A
identidade inclui os subdiretórios dentro de `agent/agents/mode/modes`. A inspeção
recusa históricos mistos ou formatos desconhecidos; conflitos de configuração
mantêm a escolha nativa e aparecem nos diagnósticos. JSONC é aceito como entrada;
a saída JSON não preserva comentários, mas o arquivo original permanece intacto.

A saída não é adotada automaticamente. Revise o documento e selecione-o
explicitamente na configuração do cliente/serviço. Para testar um histórico novo,
um processo isolado pode selecionar `OPENCODE_DB=/absolute/current-history.db`.
O comando não troca o banco do serviço instalado. Preferências de terminal
convertidas devem ser adotadas como `cli.json`; temas são selecionados como temas
customizados. Essa conversão trata arquivos da arquitetura anterior; evolução de
schemas do armazenamento local do navegador continua sob responsabilidade das
respectivas extensões e não cria outro runtime.
O startup também preserva um diretório histórico `~/.red/redcode`; não o renomeia
para `~/.red/code`. `packages/util/src/global.test.ts` verifica essa preservação
com a seleção real de caminhos do artefato Redcode.

## Matriz de capacidades e responsáveis

Desktop e Web compartilham a aplicação em `packages/app`; Desktop acrescenta
integração com o sistema operacional. Console é a interface administrativa servida
pelo Server. A matriz distingue uma jornada disponível de um contrato comprovado.

| Capacidade                             | CLI                                                      | TUI                                              | Desktop/Web                                                      | Contrato proprietário                                                                             |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Configuração e providers explícitos    | Arquivo atual; `migrate inspect/convert`                 | Mesmo documento; preferências atuais             | Settings e seleção de conexão; configuração por Location         | Core `config/{config,agent,provider}.test.ts`; CLI `migrate.test.ts`                              |
| Status de LSP por diretório            | API e configuração de Location                           | Status da Location                               | Settings mostra conectado/erro, root e retry                     | App `regression/settings.spec.ts`, casos `project LSPs`                                           |
| Conversa, interrupção e reconexão      | Session/Core atuais                                      | Mesmo Session/Core                               | Composer, timeline e conexão compartilhada                       | Core `session-execution.test.ts`; App `timeline-stream.spec.ts` e `session-location-sync.spec.ts` |
| Permissões, MCP e Vault                | Serviços de domínio                                      | Docks de solicitação                             | Docks com entrada preservada e retry; segredo mascarado          | App `session-request-docks.spec.ts`; Server/Core continuam responsáveis por autorização           |
| Histórico e arquivamento               | `session list --archived`; `session archive [--restore]` | Seletor: Ctrl+R alterna; Ctrl+E arquiva/restaura | Home: listas ativa/arquivada e menu contextual                   | Core `session-archive.test.ts`; Server `session-update.test.ts`; App `home.spec.ts`               |
| Objetivo, decomposição e reconciliação | Ferramentas de objetivo/tarefas e API                    | Ferramentas e inspeção de tarefas                | Agents → Tasks, dependências, bloqueios, aplicação e recuperação | Core `session-todo.test.ts`, `session-goal-judge.test.ts`; App `agents.spec.ts`                   |
| Design, aprovação e handoff            | Ferramentas Design; host dedicado                        | Entrada Design e revisão no host                 | Canvas/revisão incorporada e host Design                         | Core `design-gate.test.ts`, `design-task-phases.test.ts`; App `design-embedded-review.spec.ts`    |
| Administração e transporte             | Service e comandos HTTP/RPC                              | Conexão com Server                               | Console administrativo; Desktop integra o host                   | Server `owned-paths.test.ts`; CLI `service-smoke.ts`; smoke do binário no CI                      |

Os renderizadores React existentes de Settings, Home, Agents e Design usam o DS
oficial. Serviços Solid, extensões e partes da timeline ainda são compartilhados
por adaptadores. Esta entrega conecta os contratos e valida as seis jornadas;
não representa a conversão integral de todos os renderizadores para React.

## Contrato de arquivamento

`POST /api/session/:sessionID/archive` recebe `{ "archived": true|false }`.
Uma Session desconhecida retorna 404; trabalho pendente retorna 409. A transação
verifica a família inteira: execução ativa/suspensa, inbox, shell em execução,
objetivo aberto, tarefas incompletas, aplicação pendente, reserva de worker não
liberada e resultado de background ainda não consumido. Uma reserva expirada
continua pendente até liberação confirmada.

O evento durável registra somente a escolha de arquivar/restaurar; a projeção
preserva a data de atividade. Listagens públicas excluem arquivados por padrão;
`archived=include|only|exclude` é aplicado antes da paginação. Contabilidade,
recuperação e remoção interna continuam enxergando descendentes arquivados.
Enquanto um ancestral está arquivado, admissão de trabalho e aquisição de execução
são bloqueadas. Restaurar não envia prompt, não consome inbox e não acorda o runner.

As transações protegem a admissão de inbox, criação de filhos, escrita de objetivos
e tarefas e aquisição de execução. O lançamento de um shell avulso mantém a
verificação anterior ao spawn; ainda não tem uma reserva atômica entre processos
que cubra o intervalo até a publicação de `session.shell.started`. Uma solicitação
de shell concorrente com arquivamento nesse intervalo exige tratamento posterior;
esta entrega não oferece garantia de exclusão para esse intervalo nem execução
distribuída exatamente uma vez.

O corte adicional proposto, sujeito à decisão do solicitante, é registrar uma
admissão de shell identificada por Session e runtime antes do spawn, na mesma
transação que verifica `writableGate`. O arquivamento deve considerar essa admissão
pendente na família inteira. Publicar `session.shell.started` consome a admissão;
uma falha confirmada a libera, e um início de resultado incerto permanece pendente
para reconciliação, sem executar o comando novamente. Isso exige persistência,
recuperação e testes com o início pausado, falha de spawn e concorrência entre
conexões ao mesmo banco. Essa ampliação ainda não foi aplicada.

## Validação e limites

O job `browser journeys` do workflow `redcode.yml` usa um bundle de produção,
keepers das seis jornadas e um servidor local isolado com `ServerFetch` real para
arquivamento/restauração após reload. Os demais casos usam respostas controladas;
não comprovam disponibilidade de provider, Vault externo ou worker remoto.

O workflow mantém o smoke do serviço compilado, o smoke do arquivo de distribuição
e as lanes nativas de Desktop. Publicação depende também do job de navegador.
Uma execução local Linux não comprova Windows/macOS; esses resultados pertencem
às lanes nativas do CI. O servidor e os aplicativos instalados não são reiniciados
por esta validação.

O comando canônico é `bun run check` na raiz; testes de domínio rodam a partir de
cada pacote. OpenAPI e clientes são regenerados pelos scripts oficiais. O cache
de typecheck agora incorpora dependências de workspace; declarações emitidas por
Core/App são preservadas como outputs, para evitar checks de consumidores com
declarações antigas.
O OpenAPI versionado estava defasado: a regeneração passa de 113 para 233 paths,
incluindo contratos que o Server já expunha. A alteração funcional deste plano
adiciona o endpoint de arquivamento e retira o endpoint de conversão automática;
o volume do diff gerado não corresponde a 120 funcionalidades novas.
O runner de contratos isola HOME/XDG por subprocesso. O runner do Core usa ainda
um diretório de trabalho temporário, impedindo que a descoberta ascendente leia
a configuração pessoal de um checkout ancestral. Testes que executam scripts
usam caminhos absolutos; os testes de configuração continuam exercitando arquivos
reais em seus diretórios de fixture.

Evidência local desta entrega:

- `bun run check`: 27 tarefas de lint/typecheck concluídas.
- `TMPDIR=<owned-directory> bun run script/test-redcode.ts`: 4.318 testes passaram,
  63 pulados, nenhuma falha; inclui Core, CLI, Server, clientes, TUI, schemas,
  temas, SDK e sidecar.
- `packages/app`: 779 testes de unidade passaram; os 18 casos críticos de
  navegador passaram em produção e um caso adicional usou `ServerFetch` real.
- OpenAPI passou em `check:generated`; a regeneração dos clientes preservou os
  hashes de todos os arquivos gerados. Workflow validado com actionlint 1.7.12 e
  lockfile validado em modo frozen.
- CLI Linux compilada como artefato Redcode local, sem Web incorporada:
  `--version`, inspeção/conversão com origem preservada e arquivamento/restauração
  contra `ServerFetch` real passaram. SHA-256 do binário local:
  `0d4a6c55c3a3bcce937af1de7188940b65e8a2985633ea1da345543a57c6df19`.
- [Performance: comandos, contexto e resultados](performance/consolidation.md).

Essas verificações locais não substituem a execução remota das lanes nativas de
Windows/macOS nem comprovam uma publicação. Não houve publicação nesta entrega.
