# Objetivo compartilhado e convergência: validação local

Base: `80b1439abe`, em `main`. Este incremento continua a adoção descrita no
[estudo dos upstreams](upstream-review-2026-10-25.md).

## Contrato implementado

O objetivo persistido fornece o contexto comum: identidade, texto, critérios,
gates, fase de encerramento e escolha de executar o plano. A versão é o hash desse
contrato; contadores de uso, revisão de controle e pausa/retomada ficam fora dela.
Cada delegação vinculada a uma tarefa guarda o snapshot no brief durável e o recebe
no prompt. A revisão do resultado também recebe o objetivo capturado.

O grafo e a reconciliação usam a mesma observação de contexto e atribuições.
Mudanças no contrato deixam a contribuição antiga desatualizada e impedem sua
aceitação e combinação. A continuação do filho recebe o contrato atual. A ausência
de contexto em uma delegação antiga não comprova alinhamento a um objetivo
registrado; ela precisa ser continuada. Sessões sem objetivo mantêm os contratos
de tarefa existentes.

`convergence` é uma projeção dos resultados exigidos, aceitos e ainda pendentes.
Ela acompanha a aceitação e o encerramento da execução. A validação do candidato
Git e a observação de sua aplicação continuam sendo etapas distintas. Não há
outro scheduler nem novos eventos de progresso derivados.

## Verificações

- `bun run check`: lint passou e 27 tarefas de typecheck concluíram.
- Core: 36 testes de subagentes, brief/revisão, recuperação entre processos e
  contratos de integração passaram. Dois cenários do runner que usam `todowrite`
  também passaram.
- Server: dois testes de tarefas/API e nove testes de integração Git passaram.
  Os fixtures de integração agora capturam um objetivo comum. Um caso adicional
  troca o objetivo e demonstra recusa da combinação, preservando o HEAD do destino.
- O cenário integrado verifica estabilidade da versão após contabilização de
  tokens e pausa/retomada, invalidação após troca de objetivo, continuação do mesmo
  filho e convergência somente após a verificação do coordenador.
- O teste com dois processos verifica que os snapshots dos dois filhos e do
  coordenador sobrevivem à recuperação, junto da entrega deduplicada dos resultados.
- Os testes HTTP foram executados pelo runner isolado do Core, com caminhos
  absolutos para os arquivos do Server. As leituras não alteram tarefas nem pausam
  o objetivo de outro processo.
- Dois testes Playwright do keeper `regression/agents.spec.ts` passaram contra
  o build de produção. Cobrem DS, contexto recebido, contribuições pendentes,
  relatório de objetivo antigo, recuperação por refresh, revisão/aplicação e
  navegação para o filho. O fluxo foi exercitado em 1440×900 e 390×844.
- `bun run typecheck:e2e`, a geração do cliente e as checagens focadas de
  formatação e `git diff --check` passaram. Os arquivos gerados foram produzidos
  pelo comando oficial de `packages/client`.

A primeira CI apontou que faltava o documento OpenAPI versionado. Após regenerá-lo
em `packages/protocol`, os comandos `check:generated` do Protocol e do Client
passaram, sem alterações adicionais no SDK.

Os grupos se sobrepõem em execuções de diagnóstico; não some todas as execuções
como testes únicos. Não foram usados providers reais ou credenciais de usuário.

## Diagnósticos de infraestrutura de testes

A coleta de cobertura do Vault havia perdido os caminhos das fontes quando o
runner do Core passou a executar em um diretório temporário. O runner agora torna
os caminhos LCOV absolutos antes de remover esse diretório. O novo teste de
regressão falhou antes da correção e passou depois. Os 15 testes do coletor
passaram; a coleta completa passou com 99,39% de linhas e 97,88% de funções,
mantendo os limites de 90%/90% e o mínimo por arquivo de 75%.

O benchmark de primeira navegação foi executado antes das mudanças de interface:
as três repetições falharam na classificação de um frame, sem frames vazios. A
comparação posterior também identificou esse problema. Uma tentativa de rebuild
ultrapassou os 120 segundos do harness; o diagnóstico foi repetido contra o build
servido por um preview exclusivo do teste. Medições sob carga de typecheck não
permitem concluir ganho ou regressão de latência. Esse diagnóstico preexistente
continua aberto; os testes funcionais de Agents passaram.

## Alcance

Este é o primeiro fluxo sobre o objetivo persistido, tarefas e recibos existentes.
Edição colaborativa de contexto, distribuição remota completa, novos medidores de
custo, streaming e compactação em background continuam fora deste incremento.
Os testes de navegador usam dados determinísticos; os testes de Core e HTTP/Git
exercitam os serviços reais em fixtures locais. Nenhuma instância instalada foi
reiniciada durante a validação.
