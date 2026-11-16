# MARKDOWN-CACHE-010 — memória do cache de Markdown

- Estado: `REJECTED` para reescrita Rust; otimização TypeScript no caminho padrão.
- Jornada: renderização e retorno a mensagens de conversas no renderer.
- Contrato: preservar o conteúdo renderizado, a atualização LRU, o limite de
  entradas e a disponibilidade da entrada mais recente, inclusive se for maior
  que o orçamento; itens evictos podem ser renderizados novamente.
- Meta: reduzir em pelo menos 25% o heap retido no cenário sintético de 200
  entradas, sem falhas nos testes do cache e de renderização.

Em Chromium isolado, 200 entradas sintéticas com texto e HTML de 64 Ki caracteres
cada aumentaram o heap após GC de 1,36 para 26,39 MiB. O ensaio usa bundle de
desenvolvimento e conteúdo artificial, não mede Electron nem comprova vazamento.
O teste inicial com strings externas/deduplicadas não é comparável e foi
descartado; o baseline válido força strings distintas e materializadas.

A PoC aplica orçamento estimado de 32 MiB aos dados do cache, contabilizando
dois bytes por unidade UTF-16, com limite de 200 entradas e uma exceção para
manter a entrada mais recente se ela for maior que o orçamento. O orçamento é
uma estimativa conservadora, não mede diretamente a memória compartilhada.

Na comparação, o heap adicional após GC caiu de 25,03 para 15,91 MiB e as
entradas retidas de 200 para 127 no mesmo cenário sintético. A repetição após
integrar a mudança deu o mesmo resultado aproximado. O limite é estimado; uma
única entrada maior continua armazenada para permitir a leitura após preload.

Passaram os testes unitários de LRU, substituição, limite por quantidade e item
maior que o orçamento; uma regressão em Chromium confirmou preload, remoção e
renderização novamente com worker real. A abertura da conversa passou em
1440 px e 390 px. O primeiro ensaio de abertura expirou com origens diferentes;
outro revelou uma rota de tarefas ausente na fixture e uma navegação que
esperava a carga enquanto o worker era retido pelo próprio teste. Com a fixture
e a sincronização ajustadas, as duas larguras passaram. A reescrita Rust não foi
necessária para esta redução. A medição não estabelece o ganho total no Electron.
