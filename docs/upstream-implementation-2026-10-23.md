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
o novo painel por objetivo.

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

## Aplicar o candidato aceito

Depois de concluir a tarefa com o recibo de validação, use a conexão confiável do
host para chamar `session.todo.applyIntegration`:

```http
POST /api/session/:sessionID/todo/:taskID/integration/apply
Content-Type: application/json

{
  "requestID": "integration-request-1",
  "revision": 4,
  "candidateHead": "<SHA completo do candidato aceito>"
}
```

A revisão deve ser a atual da tarefa aceita. O servidor confere novamente os
aceites, a evidência e o contrato, os SHAs das fontes, o destino original limpo e
a revisão conjunta determinística. A operação registra e publica `pending` antes
de avançar o destino, e `applied` após observar o SHA esperado no destino limpo. Admissão e aplicação
incrementam a revisão da tarefa e ficam no histórico. Esses recibos pertencem ao
host, separados da prova aceita: não alteram o hash consumido pelas tarefas
sucessoras. `started` é o horário da admissão; `completed` é o horário da
observação da aplicação, inclusive quando ela ocorre durante uma recuperação.

Conserve os três campos originais para repetir a requisição. Uma identidade já
usada com outra revisão ou SHA é recusada. Um resultado aplicado retorna o mesmo
recibo; uma admissão pendente somente observa o Git. Se HEAD corresponde ao
candidato e o destino está limpo, registra a aplicação já encontrada. Outro SHA
ou alterações locais mantêm `pending`, sem executar novamente o merge. Novas
requisições e novo preparo não substituem uma admissão pendente.

Uma queda antes do merge, uma execução Git com erro ou um destino alterado exigem
reconciliação explícita no host. Examine o comando original e eventuais processos
Git/hooks ainda ativos, preserve alterações locais e resolva o destino antes de
repetir a requisição original. Não há abandono ou replay automático de operações
ambíguas. O bloqueio local por projeto conserva o handler até seu Git terminar;
não coordena comandos Git externos nem implementa fencing distribuído.

O objetivo recusa conclusão enquanto houver aplicações pendentes, inclusive de
tarefas canceladas, ou candidatos aceitos sem recibo de aplicação correspondente.
A interface Agents por objetivo e a integração entre hosts permanecem pendentes.

## Catálogo V1/V2 compatível

O consumidor reconhece o formato publicado em
`https://models.dev/experimental/v2.0/api.json`, além do V1. Para experimentar V2,
configure a fonte pelo `REDCODE_MODELS_URL` ou pelo campo global `models.sources`.
A lista pública padrão e o snapshot empacotado continuam V1; não há mudança
silenciosa de fonte nem promessa de disponibilidade por conta/credencial.

`Model.Info.catalog` conserva a versão do formato e o SHA-256 dos bytes recebidos,
as APIs declaradas com os SDKs e as capacidades efetivas de cada protocolo, os
MIME types originais e os preços com moeda, unidade e denominador. Os IDs usados
para executar o modelo permanecem os do provedor; a identidade canônica fica em
seu campo próprio. URLs de transporte e backoff continuam no estado das fontes;
o digest identifica o conteúdo observado, sem expor credenciais de uma URL de mirror.

Uma política local prefere responses, messages, generate-content, converse,
cohere-chat, chat-completions, interactions e workers-ai-run, nessa ordem, entre
os adapters declarados e registrados no Redcode. Nomes de SDK desconhecidos e
APIs futuras permanecem descritivos. Modelos especializados e ofertas sem adapter
local não viram rotas de chat. Limites omitidos ficam em zero, sem inventar uma
janela utilizável. A elegibilidade local não comprova uma chamada de inferência
remota. As flags de atualização de tools, system e effort são preservadas; uma
flag positiva de effort não habilita por si só uma otimização de cache. A flag
`replay_reasoning` não equivale a exigir campos vazios de raciocínio em todas as
mensagens; conserva-se como declaração, sem essa conversão de comportamento.

Preços por token e caractere carregam denominador de um milhão; imagem,
megapixel, segundo e minuto conservam sua unidade. Web search usa mil buscas.
Condições, multiplicadores, preço separado de reasoning e TTLs de cache permanecem
em `catalog.pricing` e nos detalhes dos rates. Apenas tarifas de tokens
incondicionais que cabem no estimador existente alimentam `Model.Info.cost`.
Regras condicionais, cache explícito/TTL, reasoning cobrado de forma diferente e
unidades não representáveis não são simplificados para uma tarifa inventada.

Uma lista `cost` vazia representa preço ausente ou estimativa não representável.
O classificador compartilhado de gratuidade exige entrada, saída e cache conhecidos
como zero, além de ausência de cobranças adicionais declaradas. O consumo e a
contabilidade histórica continuam numéricos: isso ainda não constitui cálculo
completo de tarifas condicionais/mídia nem comprova cobrança real. As projeções
históricas V1 e os demais consumidores de custos continuam uma etapa de migração.

As entradas de arquivo, rede e cache passam por validação estrutural. Uma resposta
HTTP 200 com JSON inválido para o catálogo, preço base negativo ou capacidade
consumida de tipo incorreto não substitui o cache bom. O refresh conserva a publicação global, a
supressão de bytes idênticos e a atualização de caches antigos sem digest. O teste
de snapshots compartilhados também cobre mutação de arrays JSON em uma Location
sem modificar as outras Locations ou a fonte original.

A resposta V2 real observada foi normalizada pelo serviço com armazenamento
temporário isolado. O [registro de validação](evaluations/model-catalog-2026-10-23-validation.json)
fixa seu hash, contagens e limites. A validação local terminou com 149 testes de
Core, 20 de apresentação e `bun run check` aprovado nos 27 tasks. Nenhum provedor
recebeu uma chamada de inferência ou credencial durante essa avaliação.

## Estimativas condicionais e cobertura de custos

O runtime conserva o catálogo resolvido e avalia as tarifas V2 condicionais quando
a projeção de preços por token está vazia. Preços por token explicitamente
fornecidos pelo modelo/configuração continuam tendo precedência. Um USD válido
informado pelo provedor, inclusive zero, sempre prevalece sobre as estimativas;
o recibo de RedRouter também mantém essa precedência.

O avaliador aplica overrides na ordem publicada, com merge dos campos de cache e
TTLs, e depois todos os multiplicadores correspondentes. Suporta condições
numéricas, strings comparáveis, igualdade, listas, `min_items`, `all`, `any` e
`not`. Uma condição com chave desconhecida é ignorada conforme o contrato do
catálogo. Uma condição conhecida sem o fato necessário deixa a cotação
indeterminada. Contexto vem dos tokens normalizados; service tier e outros fatos
simples vêm das opções/defaults e do body da requisição preparada, sem inventar
uma região ou tier padrão. Uma mudança de ID/provedor do modelo na requisição
invalida a estimativa do catálogo original.

`ModelPricing.quote` aceita medidas explícitas de tokens, caracteres, imagens,
megapixels, segundos, minutos e buscas. Tokens/caracteres usam um milhão de
unidades, buscas usam mil e as demais unidades usam uma unidade. Reasoning pode
ter tarifa própria; um TTL de escrita de cache precisa ser informado quando a
tabela o distingue. A passagem de medidas explícitas não constitui descoberta
automática de consumo de mídia ou ferramentas nativas.

As chamadas da sessão usam os tokens normalizados e os fatos observáveis da
requisição. Chamadas V2 com mídia ou declarações de ferramentas nativas permanecem
sem estimativa completa quando não há USD informado pelo provedor. Armazenamento
de cache, modo explícito/implícito sem distinção no usage, TTL não observado,
unidades incompatíveis e fatos de preço ausentes não viram tarifas zero.

Os eventos novos `session.step.ended`, `session.step.failed` e
`session.usage.recorded` conservam `costAssessment`. Mensagens assistant projetam
a mesma informação. A classificação é:

| Status | Significado |
| --- | --- |
| `reported` | USD informado pelo provedor/gateway; não é conciliação de invoice. |
| `estimated` | Valor calculado com preços e medidas disponíveis. |
| `unknown` | A cotação não foi resolvida; o número compatível não representa custo total. |

O valor numérico `cost` continua compatível. Uma chamada sem cotação usa zero
como contribuição numérica e traz status desconhecido. Uma soma com partes
conhecidas e desconhecidas conserva o subtotal conhecido e marca a soma como
incompleta. Históricos anteriores permanecem sem classificação, sem recalcular
valores nem atribuir uma origem retroativa. O digest do catálogo é conservado
quando a cotação utiliza suas regras V2; a avaliação por uma projeção local de
preços não a atribui indevidamente ao catálogo original.

As estatísticas retornam `costCoverage` com contagens `reported`, `estimated`,
`unknown` e `legacy`. São registros contábeis nos mesmos escopos dos totais
existentes, não contagens de requests ou de invoices. A cobertura por modelo
acompanha suas mensagens; a cobertura geral inclui os registros de compactação
que já participavam do total. Títulos mantêm o escopo anterior das estatísticas.

O orçamento reutiliza `spent.unpriced`, derivado dos eventos novos e das
avaliações S1 existentes, incluindo descendentes. As somas de compactação não
são contadas novamente como novas chamadas. O indicador `unknown` e o texto
`some cost unknown` aparecem no orçamento em USD quando houver pendências. A
política anterior continua: um valor não resolvido sinaliza incompletude, sem
inventar uma cobrança nem declarar o limite de USD atingido. Com custos não
resolvidos, esse limite não garante um teto sobre cobranças externas.

A validação cobre o runner com transporte LLM simulado e o caminho real de
admissão/execução/projeção, além do banco e do Bus persistidos para mensagens,
estatísticas e orçamento. O [registro deste lote](evaluations/conditional-pricing-2026-10-23-validation.json)
conserva os resultados. Não houve conciliação de fatura nem publicação. Consumo
de mídia/cache detalhado pelos adapters e adoção da cobertura nos demais clientes
continuam pendentes antes do cutover padrão do catálogo.

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

A entrada fria de sessão teve uma amostra inicial de aproximadamente 1.837 ms.
As comparações após a mudança registraram 1.788 ms e 5.828 ms, a última sob
compilação concorrente. Três repetições sem compiladores concorrentes ficaram em
1.064, 1.379 e 1.340 ms, sem sessão incorreta. A variação sob carga não foi
reproduzida nessa repetição, mas a amostra não estabelece ganho estatístico de
velocidade ou garantia de desempenho contínuo.

A validação consolidada terminou com 382 testes de Core passando, 42 pulados por
plataforma, cinco testes HTTP passando e 11 casos de navegador no build de
produção. `bun run check` passou em seus 27 tasks de lint/tipos; os tipos dos
fixtures E2E e `check:generated` também passaram. O [registro de validação](evaluations/upstream-adoption-2026-10-23-validation.json)
fixa o commit, a árvore de pacotes, os resultados e os hashes dos logs locais.

Os registros de execução ficam em `/var/tmp/redcode-upstream-*.log` e as imagens
nos resultados Playwright locais. Testes locais não comprovam publicação ou
comportamento de todos os provedores. As exceções de plataforma dos testes são
mantidas explícitas; nenhum serviço do usuário foi reiniciado.

A aplicação orientada pela tarefa passou em 14 testes HTTP/Git e 15 testes de
Core, com `bun run check` aprovado nos 27 tasks. O teste adicional de higiene dos
contratos encontrou um problema anterior:
`model-suggestion.ts` e `connection-check.ts` usam `Schema.mutable`/`mutableKey`.
Esses arquivos são idênticos aos do commit inicial deste lote; 27 dos 28 casos de
Schema passaram. O [registro da aplicação](evaluations/task-integration-application-2026-10-23-validation.json)
conserva os resultados e as observações dos limites de recuperação. A recuperação
foi exercitada a partir de registros persistidos nas fronteiras antes/depois do
merge; isso não constitui um ensaio de morte real de processo com Git/hooks órfãos.

## Trabalho que permanece

1. Expor o fluxo de preparo, validação e aplicação no Agents; ampliar a recuperação
   explícita de aplicações ambíguas e a coordenação entre hosts.
2. Conectar os meters de mídia/cache dos providers e a cobertura de custos aos
   demais clientes, e validar o cutover padrão do catálogo para V2.
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
