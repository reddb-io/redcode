# BROWSER-005 — retenção do console do navegador embutido

- Estado: `REJECTED` para reescrita em Rust; correção existente validada em regressão.
- Jornada: páginas embutidas no desktop, diagnóstico de console e exceções.
- Evidência: [incidente e reprodução](../../transport-performance.md#desktop-idle-memory-incident-2026-11-11).

Na reprodução documentada, o console do Chromium reteve cerca de 32 MB em
objetos após coleta de lixo; `Runtime.discardConsoleEntries` liberou essa
retenção. O diagnóstico já chama essa operação após copiar os dados necessários.
O teste `desktop-browser.spec.ts` passou em 13/11/2026 com Chromium real,
verificando preservação do texto e liberação dos objetos.

Decisão: não criar uma PoC Rust para esta fronteira. A retenção é interna ao
Chromium e é controlada pela API CDP; reescrever o consumidor não liberaria os
objetos por si só. A reprodução não atribui todo o pico de 16 GB do incidente a
essa causa. Para investigar o restante, é necessário medir o desktop empacotado
por processo durante uso prolongado, sem presumir que outro módulo seja culpado.

## Triagem seguinte: troca de sessões

Em 13/11/2026, uma execução do benchmark do renderer com 1.200 modelos fictícios
e dez trocas entre duas sessões mediu heap após GC de 88,36 MiB inicialmente,
93,75 MiB após a primeira troca e 94,07 MiB após a décima. Os nós DOM passaram
de 1.579 para cerca de 2.040 e estabilizaram. A primeira troca também abre uma
segunda sessão; não identifica, por si só, vazamento ou causa do OOM. O teste
de atualização do modelo também passou. Dados em
[`renderer-provider-memory-2026-11-13.json`](../../evaluations/renderer-provider-memory-2026-11-13.json).

É uma amostra em Chromium com build de desenvolvimento e APIs simuladas, não
Electron empacotado nem RAM total. Esta jornada isolada não demonstrou crescimento
material contínuo nas dez trocas e não justifica PoC Rust com essa evidência.

## Processos do desktop empacotado

Na série anterior de cinco inicializações frias do desktop Windows x64 empacotado
em ambiente isolado, as medianas de working set foram 156 MiB no processo
principal, 150 MiB no renderer, 126 MiB no GPU, 49 MiB no utility e 79 MiB no
crashpad. São amostras na tela inicial: páginas compartilhadas podem aparecer em
mais de um processo, o servidor separado não está incluído, e elas não medem
crescimento prolongado. As cinco amostras estão em
[`desktop-startup-cold.json`](../../evaluations/desktop-startup-cold.json).

Em 13/11/2026 foi executada uma cópia isolada do pacote com um build novo dos
fontes do desktop e dependências reaproveitadas do pacote anterior. O runner usa
perfil, banco e porta isolados, desativa registro de links/atalhos e usa o CLI
instalado 0.87.29; não é uma release reproduzível com binários da mesma revisão.
A associação Windows `redcode://` permaneceu idêntica antes e depois e os
processos da cópia foram encerrados. Uma amostra fria em Home mediu working set
de 161 MiB no processo principal, 156 MiB no renderer, 134 MiB no GPU, 50 MiB
no utility e 80 MiB no crashpad; o heap JS do renderer era 25 MiB. Essas
medidas são apenas uma fotografia e não incluem o servidor, que roda separado.
O relatório bruto está em
`C:/Users/filip/artifacts/redcode-rust-study-2026-11-13/desktop-bench-isolated-results/`.
Para atribuir crescimento falta medir backend, renderer e páginas embutidas ao
longo da mesma execução, com versões e carga representativas.

Uma segunda execução isolada registrou o servidor separadamente: 439 MiB de
working set para `redcode.exe`, além de processos filhos identificados pelo
runner; no mesmo instante, principal/renderer/GPU/utility/crashpad mediram
161/156/127/50/80 MiB. São valores por processo, não memória exclusiva, e não
identificam o módulo responsável. O runner agora registra a árvore do serviço e
encerra o serviço ao final também em inicializações frias. Nesta execução, todos
os PIDs observados na árvore tinham terminado após o runner e o registro isolado
foi removido. A primeira versão do ensaio deixou o serviço isolado ativo; ele foi
identificado e encerrado explicitamente antes da segunda execução.
Relatório: `C:/Users/filip/artifacts/redcode-rust-study-2026-11-13/desktop-bench-backend-results/startup-1794607451432.json`.
