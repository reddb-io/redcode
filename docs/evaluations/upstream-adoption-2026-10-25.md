# Adoção dos upstreams: primeiro lote

Este registro acompanha a implementação do primeiro lote proposto no
[estudo de 25/10/2026](upstream-review-2026-10-25.md). O estudo descreve o checkout
na base `60d5b50306`; este documento distingue as mudanças locais das investigações
que continuam abertas.

## Implementação

- **Base64:** adotada a validação linear de
  [OpenCode #58811](https://github.com/anomalyco/opencode/pull/58811), mantendo o
  pattern público. A validação local exige fim exato da entrada, inclusive quando
  uma quebra de linha completa um comprimento múltiplo de quatro. Os testes cobrem
  padding, caracteres inválidos, truncamento e um anexo de 5 MiB.
- **Schemas de ferramentas:** adaptado
  [OpenCode #58848](https://github.com/anomalyco/opencode/pull/58848) ao registro e
  ao Code Mode do Redcode. O registro guarda a definição convertida, invalida-a no
  reload e mantém o executor capturado pelo snapshot. Hooks recebem uma cópia
  profunda do schema de entrada para que alterações aninhadas não atravessem
  requisições ou Sessions.
- **Permissões:** corrigidas as divergências confirmadas na avaliação de recursos
  de shell e arquivos. As regressões exercitam os dois parsers, o serviço de
  permissões e o preflight da ferramenta real. O detalhamento de segurança e os
  limites da correção ficam no relatório de validação gerenciado pelo Codex Security.
- **Argumentos interrompidos:** reforçado o cenário existente de falha do provider
  após argumentos malformados. O próximo pedido contém o registro da chamada
  malsucedida com entrada vazia; a ferramenta não executa os argumentos inválidos.
- **Imagens grandes:** adicionados seis casos offline ao compilador real dos
  protocolos OpenAI Chat, OpenAI Responses e Anthropic Messages: um payload inline
  de 5 MiB ou sete de 200 KiB. A serialização preserva todos os payloads. Esses
  fixtures exercitam transporte/compilação, sem decodificar PNGs ou consultar providers.

As alterações de produto estão registradas em
[`upstream-runtime-boundaries`](../../.changeset/upstream-runtime-boundaries.md).
A geração do cliente terminou sem diferenças nos arquivos gerados.

## Validação

Todos os testes do Core foram executados por `bun run test`, a partir de
`packages/core`, com o isolamento de HOME/configuração do runner do repositório.

| Escopo                                                                     | Resultado                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Permissões, shell/scanners e compatibilidade dos dois parsers: 20 arquivos | 2.380 passaram, 341 pulados, nenhuma falha      |
| Arquivos, registro, Code Mode, hooks, permissões e shell: 16 arquivos      | 620 passaram, 42 pulados, nenhuma falha         |
| Compilador de requests: `packages/ai/test/compile.test.ts`                 | 19 passaram, incluindo os seis casos de imagens |
| Base64: `packages/schema/test/prompt.test.ts`                              | 3 passaram                                      |
| Cenários focados de registro, hooks, permissões, shell e runner            | 37 passaram                                     |

As suítes se sobrepõem; os números não devem ser somados como testes únicos.
Uma primeira execução da suíte de scanners teve um timeout no teste de saída de
shell enquanto checagens completas concorriam por recursos. O teste passou
isoladamente e a repetição completa dos 20 arquivos passou em 38,6 segundos,
mantendo o timeout original dos testes.

O `bun run check` final passou: lint sem avisos ou erros e 27 tarefas de typecheck
concluídas. A geração do cliente e o `git diff --check` também passaram, assim como
a checagem de formatação dos arquivos alterados neste lote.

## Medição local de Base64

Bun 1.4.4, Linux, cinco execuções intercaladas por tamanho, com `Schema.is` tanto
para a expressão anterior quanto para o schema atual. Valores abaixo são medianas
de tempo decorrido, em milissegundos, medidos nesta máquina em 25/10/2026.

| Payload antes da codificação | Anterior | Atual |
| ---------------------------- | -------: | ----: |
| 64 KiB                       |    0,119 | 0,122 |
| 1 MiB                        |   64,237 | 1,312 |
| 5 MiB                        |  323,531 | 6,393 |

São medições de uma operação local sob carga de desenvolvimento. Não medem CPU
total de uma sessão, redimensionamento de imagem, latência do provider ou a UI.

## Limites e continuidade

A falha completa de screenshot/redimensionamento relatada upstream continua sem
reprodução local. Os seis testes de compilação não permitem classificá-la como
corrigida. A ampliação de permissões também não transforma regras textuais de shell
em isolamento de processos; PowerShell e outros lançadores precisam de investigação
própria antes de receber novas garantias.

O próximo lote do estudo continua sendo contexto comum versionado, convergência de
resultados, streaming para clientes lentos e transparência por objetivo. Compactação
em background, custos de ferramentas MCP, workflows, colaboração e memória opt-in
permanecem trabalhos separados sobre os contratos atuais.

Estas mudanças são locais em `main`. Este lote não instalou uma versão, publicou
release ou reiniciou o servidor usado pelo usuário.
