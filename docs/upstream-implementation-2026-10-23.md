# Adoção dos upstreams: execução de 23 de outubro

O [estudo](evaluations/upstream-review-2026-10-23.md) é a fotografia das fontes.
Este documento acompanha a implementação; uma referência estudada não passa a
ser funcionalidade entregue por estar no inventário. O [ledger deste lote](upstream-2026-10-23-adoption.json)
conserva os PRs selecionados e as pendências.

## Correções e capacidades implementadas

| Área            | Comportamento                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP startup     | Uma operação connect/disconnect já concluída impede o startup inicialmente agendado de abrir outra conexão ou reativar um servidor.                                                                                                                                                        |
| MCP shutdown    | As conexões encerram em paralelo; uma espera de stdin de um servidor não retarda todos os outros. O teste usa dois processos reais que precisam receber EOF antes de sair.                                                                                                                 |
| MCP remoto      | O fetch de transporte desativa o timeout implícito de Bun e conserva o AbortSignal e os deadlines do domínio MCP.                                                                                                                                                                          |
| OAuth MCP       | Uma requisição sem código e sem state recebe erro HTTP, mas não encerra a autorização que aguarda o redirect válido. Retornos OAuth com state inválido continuam recusados.                                                                                                                |
| Formulários MCP | O dock DS React atende solicitações da sessão e de suas filhas, com strings, opções, números, booleanos, multiselect e passos externos. Erros de envio e navegação entre sessões mantêm respostas; o usuário pode tentar novamente ou cancelar. Um passo externo exige confirmação humana. |
| Compactação     | Um buffer maior ou igual à janela do modelo usa a reserva padrão do Redcode.                                                                                                                                                                                                               |
| Snapshot Git    | Sockets e outros arquivos especiais não abortam a captura de arquivos regulares. Um caminho antes rastreado conserva a entrada anterior no índice; links simbólicos legítimos continuam capturados.                                                                                        |
| Credenciais     | `credential.update` aceita `value`, `label` ou ambos. Rotacionar mantém ID e label quando omitido; alterar só o label mantém o segredo. O Client foi regenerado.                                                                                                                           |
| Recovery        | O dono da execução distingue shutdown de cancelamento humano. Shutdown conserva os registros de recuperação e não publica resultado cancelado nem grava a atividade como cancelada.                                                                                                        |
| Catálogo        | Snapshot V1 atualizado: 230 provedores, 8.909 ofertas, 62 de decisão. Refresh publica um evento global para atualizar os catálogos de outros Locations.                                                                                                                                    |
| Integração      | O shell emite recibo de validação ligado à sessão, tarefa, contrato, SHA, árvore, checkout, comando e horários observados. O aceite da tarefa exige um recibo compatível com o candidato atual.                                                                                            |

Solicitações MCP globais sem Session continuam uma superfície distinta; este
lote não as atribui arbitrariamente a uma conversa. Também não implementa ainda
o novo painel por objetivo ou a aplicação Git vinculada à tarefa.

## Como validar um candidato

Prepare o candidato pelo contrato existente `session.todo.prepareIntegration`.
Execute o check a partir de um checkout local limpo na revisão retornada, com as
dependências necessárias já disponíveis. A chamada de ferramenta é:

```json
{
  "command": "bun test",
  "workdir": "/path/to/candidate-checkout",
  "integrationTaskID": "todo_integration"
}
```

O shell conserva sua autorização normal. O parâmetro exige execução em primeiro
plano e não permite substituir um workspace remoto pelo filesystem do host.
Antes da execução, HEAD deve corresponder ao candidato e não pode haver mudanças
rastreadas ou arquivos novos fora dos ignores. Depois do comando, a mesma condição
é observada novamente. Dependências e saídas ignoradas pelo Git são permitidas.

Um comando que falha, excede seu timeout ou deixa o checkout alterado não recebe
recibo. Uma prova antiga, de outra sessão, tarefa, revisão ou contrato não conclui
o candidato. Tarefas sem candidato mantêm seu contrato de evidência anterior.

O recibo descreve a invocação e as observações antes/depois. Ele não prova a
cobertura semântica do teste, a imutabilidade contínua do filesystem ou efeitos
externos exatamente uma vez. O aceite do resultado e a revisão continuam nos
contratos Todo/S1 existentes. Preparar ou validar ainda não aplica Git nem conclui
automaticamente o objetivo.

## Verificação e limites

As regressões de startup MCP, callback OAuth, buffer de compactação, socket em
snapshot, rotação HTTP, perda de registros no restart e conclusão cancelada foram
observadas antes das respectivas correções. A seleção MCP foi removida
temporariamente para comprovar que o novo keeper de navegador detecta a regressão;
o arquivo corrigido foi restaurado antes da validação de produção.

O keeper de solicitações executou 11 casos no build de produção, cobrindo perguntas,
permissões, Vault, web search e MCP. Os testes de shell verificam também falha do
comando, alteração de fonte e mudança de HEAD. Os de recovery usam processos
separados e o estado SQLite persistido, incluindo atribuições de tarefa.

A entrada fria de sessão foi medida com uma amostra por revisão: a observação
estável foi aproximadamente 1.837 ms antes e 1.788 ms na comparação inicial após
a mudança. Houve trabalho concorrente na máquina. Isso é evidência de execução
do cenário, não uma estimativa estatística de melhoria ou um teste de longa duração.

Os registros de execução ficam em `/var/tmp/redcode-upstream-*.log` e as imagens
nos resultados Playwright locais. Testes locais não comprovam publicação ou
comportamento de todos os provedores. As exceções de plataforma dos testes são
mantidas explícitas; nenhum serviço do usuário foi reiniciado.

## Trabalho que permanece

1. Completar a aplicação do candidato vinculada à tarefa e sua recuperação sem
   repetir efeitos ambíguos; preservar aceites, revisões e checagens de Git.
2. Migrar o consumo do catálogo para V2 com origem/versionamento, capacidades por
   protocolo, custos desconhecidos e unidades de mídia, preservando V1 e RedRouter.
3. Completar Agents DS React por objetivo, contexto comum versionado, agrupamento
   de conclusões e exposição do grafo em workers e harnesses.
4. Implementar workflows reutilizáveis, rotinas, webhooks e conectores pelos
   contratos de admissão durável e autorização do Redcode.
5. Ampliar memória/skills, adapters de avaliação e mídia, voz e push. Mobile nativo
   e produtos de hospedagem permanecem trilhas próprias do inventário.
6. Tratar relatos de segurança segundo aplicabilidade e reprodução benigna;
   preservar Vault, isolamento de workers e permissões de execução.

O OpenBot é referência funcional sob PolyForm Noncommercial. Nenhum código dele
foi incorporado neste lote; equivalentes devem ser implementados independentemente.
