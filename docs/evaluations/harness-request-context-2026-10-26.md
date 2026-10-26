# Contexto comum dos pedidos na avaliação do harness

Segunda etapa do [plano do harness](harness-reasoning-2026-10-26.md), implementada
localmente em `main` em 26/10/2026. A [primeira etapa](harness-first-adoption-2026-10-26.md)
tratou inspeção/síntese e saída rápida de versão.

## Problema e comportamento

Antes, a classificação consultava histórico e referências a pedidos anteriores,
enquanto a revisão final recebia o último pedido, objetivo, tarefas e evidências.
Se o usuário escrevesse apenas “continue”, as restrições do trabalho podiam ficar
fora da entrada explícita do reviewer, especialmente depois da compactação.

`SessionRequestContext` agora fornece o mesmo formato de contexto para:

- classificação do pedido;
- revisão da resposta, incluindo avaliação do artefato de código;
- julgamento de progresso do objetivo;
- avaliação semântica do stop-loss.

O contexto tem um limite explícito e é derivado da projeção de mensagens:
primeiro pedido, até oito pedidos anteriores recentes e o pedido avaliado,
deduplicados em ordem de sequência. Cada entrada contém ID, sequência, texto
limitado, fingerprint e informação de truncamento. Quando existe um intervalo
mais antigo não incluído, `olderOmitted` informa essa lacuna.

A seleção fica limitada à sequência do pedido avaliado. Uma classificação
assíncrona de um pedido antigo não inclui um pedido posterior já promovido.
Filtrar por Session também impede mistura com pedidos de outra sessão. Pedidos
pendentes continuam na inbox e não fazem parte dessa história entregue.

O primeiro pedido é contexto histórico, sem presunção de que permaneça ativo.
A política instrui os avaliadores a seguir mudanças explícitas de escopo e
correções posteriores, conservar requisitos aplicáveis durante continuação
neutra e não reativar assuntos substituídos. Papel de mensagem não concede
permissão; saídas de ferramenta e de assistant não viram autorização humana.

Isso fornece evidência melhor sobre o contrato vigente. Não é um extrator
determinístico de intenção, nem prova de que um modelo identificará todo requisito
corretamente em conversas arbitrariamente longas.

## Dados, limites e evidências

As consultas selecionam apenas ID, sequência e texto de mensagens de usuário,
usando os índices existentes. Não transportam anexos nem histórico de ferramentas
para montar esse contexto. Não foi acrescentada tabela, evento, resumo gerado ou
segunda fonte persistida de estado.

O texto passa pelo scrubber do Vault e pela redação padrão antes de ser limitado
e fingerprintado. Mensagens marcadas como sensíveis ou retidas recebem o
placeholder de conteúdo restrito nesse contexto derivado. Referências de
recuperação usam a ferramenta `session_history` existente: ID para uma mensagem
limitada e busca por palavras-chave para o histórico omitido.

A inclusão divide o orçamento de fontes já existente com o histórico recente da
classificação e com os resultados de ferramentas da revisão. Isso evita apenas
acrescentar bytes a uma avaliação já próxima do teto de 80.000 caracteres. Uma
entrada extensa pode, portanto, reduzir o trecho visível de outras evidências;
seus fingerprints, referências e avisos de truncamento continuam presentes.
O teste de carga de entrada inclui pedidos e respostas extensos, tarefas,
objetivo, ferramentas e patches de quatro arquivos, e exige que o request de
revisão permaneça sob esse teto.

O formato anterior `session.continuation.originalRequest` foi substituído pelo
contexto compartilhado na classificação, evitando duas seleções diferentes de
pedidos no mesmo request. A revisão final também recebe ID/revisão do objetivo,
critérios, gates e escopo, além do estado que já recebia.

As evidências de ferramentas continuam sob seus donos atuais: `SessionTaskFacts`
preserva invalidação e frescor, e os consumidores mantêm os recortes adequados à
pergunta que avaliam. Esta etapa não substitui esses recortes por uma cópia
universal de todos os resultados. A emissão do contexto acompanha as avaliações
existentes; não foi adicionado outro avaliador. Single continua sem chamadas S1;
observe mantém sua coleta sem orientação da execução.

## Verificação

Os testes de banco usam a projeção real em SQLite, com pedidos de duas Sessions,
um pedido posterior ao limite observado, histórico longo e conteúdo restrito.
Cobrem ordem, isolamento, limite, redação e referências recuperáveis.

No teste do runner, o fluxo é:

1. Pedido: corrigir recuperação sem ativar providers automaticamente.
2. Correção: preservar conta selecionada e credencial salva.
3. Setenta mensagens sintéticas intermediárias.
4. Compactação projetada com um resumo que omite esses requisitos.
5. Novo pedido: “continue”.

O request S2 deixa de conter o pedido original na janela de mensagens. Mesmo
assim, classificação e revisão final recebem contextos iguais com os três
pedidos. Outro cenário exige duas respostas single com zero requests ao servidor
de avaliação. O transporte de avaliação do fixture é um servidor HTTP local;
os testes não consultam providers externos.

Regressão local: **373 testes passaram, zero falhas**, em oito arquivos de
contexto, runner, julgamento de objetivo, stop-loss, classificação, revisão e
controles. O typecheck focado do Core também passou.
`bun run check` passou na raiz: **27 tarefas bem-sucedidas**, 20 em cache,
em 3 min 18 s.

Os testes confirmam seleção de dados e integração do runner. Não medem ganho de
acurácia, falsos positivos, latência ou custo com modelos reais. A próxima
avaliação semântica deve incluir troca de assunto, retirada de requisito,
correção tardia, requisitos além do trecho retido e evidência invalidada depois
de edição.

Logs locais:

- `/tmp/redcode-request-context-focused-20261026.log`
- `/tmp/redcode-request-context-runner-20261026.log`
- `/tmp/redcode-request-context-typecheck-20261026.log`
- `/tmp/redcode-request-context-regressions-20261026.log`
- `/tmp/redcode-request-context-check-20261026.log`

O Changeset `review-request-context.md` registra a mudança. O checkout mantém os
lotes anteriores. Nenhum servidor instalado foi reiniciado e o lote não foi
publicado. O relato dos cinco minutos no Windows continua aguardando a
identificação do comando pelo PowerShell e a presença das variáveis de askpass;
a causa no ambiente Windows afetado ainda não foi confirmada.
