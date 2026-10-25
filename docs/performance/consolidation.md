# Evidência de performance da consolidação

Medição local em 25/10/2026, Linux x64, Intel Core i7-1065G7 (8 CPUs lógicas,
15,2 GiB de RAM), Bun 1.4.4 e Chromium 147.0.7727.15 do Playwright. Cada cenário
usa um bundle de produção, dados controlados, três repetições seriais, nenhum
retry e profiling desabilitado. Os processos instalados não foram reiniciados.

O baseline de abertura foi coletado antes dos controles de arquivamento da Home,
com a consolidação de configuração/API já aplicada sobre `0406db3502dcf2bfdd56e2907fec4bc69ae6e1e8`.
Portanto ele não representa todo o repositório limpo naquele commit. A identidade
do `dist/index.html` foi registrada por SHA-256:

- Antes: `b910fe4e858dd4f15ed4633bbe6da89ec24940340893e429817a83d22ee84f58`.
- Depois: `c190cbba53ec91a14581af046a0caf16b9825bd83ae98b8ad751008a751ca9f4`.

| Cenário                             |    Mediana | Intervalo das 3 amostras | Escopo                            |
| ----------------------------------- | ---------: | -----------------------: | --------------------------------- |
| Abrir sessão fria pela Home, antes  | 1.149,4 ms |       1.009,0–1.611,4 ms | Primeira observação correta       |
| Abrir sessão fria pela Home, depois |   879,5 ms |           873,8–954,6 ms | Primeira observação correta       |
| Estabilidade da abertura, antes     | 1.156,6 ms |       1.067,2–1.669,3 ms | Confirmação em três observações   |
| Estabilidade da abertura, depois    |   927,0 ms |         921,9–1.009,6 ms | Confirmação em três observações   |
| Troca para aba já aquecida          |    80,4 ms |             72,7–89,2 ms | Primeira observação correta       |
| Estabilidade da troca aquecida      |   158,0 ms |           147,2–172,5 ms | Confirmação em três observações   |
| Streaming de 160 deltas             | 8.059,8 ms |       8.059,2–8.085,4 ms | Conclusão observada pelo renderer |

O streaming recebeu todos os 160 deltas, sem deltas pendentes e sem substituir a
linha nem o elemento Markdown nas três amostras. O cenário usa 320 trocas de
histórico, lote de um evento, CPU em 1x e review fechado. O tempo inclui a cadência
controlada da fixture; não mede tokens por segundo de um modelo nem garante 60 fps.

A troca aquecida usa duas sessões com 400 mensagens cada e Markdown complexo,
1440×900, histórico completo em uma resposta e nenhum fetch de mensagens durante
a troca medida. A abertura pela Home usa paginação normal. Esses cenários têm
trabalhos diferentes e não devem ser comparados entre si.

Na retenção de memória, 1.200 modelos e dez trocas de sessão produziram:

| Repetição | Heap inicial após GC | Heap após dez trocas e GC | Nós DOM finais |
| --------- | -------------------: | ------------------------: | -------------: |
| 1         |            27,56 MiB |                 31,17 MiB |          2.098 |
| 2         |            27,60 MiB |                 31,15 MiB |          2.098 |
| 3         |            26,91 MiB |                 31,30 MiB |          2.123 |

Essa medida cobre somente o isolate principal do renderer. Exclui workers,
processos principal/GPU do Electron, Server e picos de alocação. A navegação visita
uma segunda sessão; o crescimento observado não demonstra, por si só, um vazamento.
Não houve baseline anterior equivalente para troca, streaming e memória: estes
valores iniciam suas séries. Três amostras de abertura também não sustentam uma
conclusão causal de otimização ou um orçamento de performance portátil.

## Reprodução

Execute a partir de `packages/app`, sem checks/builds concorrentes:

```sh
PLAYWRIGHT_BUILD=1 PLAYWRIGHT_PORT=4777 TIMELINE_CPU_THROTTLE=1 \
  bun x playwright test --config=e2e/performance/playwright.config.ts \
  timeline/session-entry-benchmark.spec.ts \
  timeline/session-tab-switch-benchmark.spec.ts \
  timeline/session-timeline-benchmark.spec.ts \
  timeline/provider-memory-benchmark.spec.ts \
  --grep 'entry: cold session from Home|tab switch: warm, review closed|streams assistant text without remounting or oscillating|measures retained renderer memory' \
  --workers=1 --repeat-each=3 --retries=0 --reporter=line
```

A fixture de memória agora declara explicitamente o modelo das Sessions; uma
seleção ausente não pode ser substituída silenciosamente pelo default do catálogo.
A coleta inicial encontrou essa incompatibilidade antes de medir memória. As nove
amostras válidas de abertura/troca/streaming foram preservadas; a memória foi
reexecutada isoladamente três vezes contra o mesmo bundle, com
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:4777` e um preview de produção já iniciado.

Os registros completos, incluindo as três tentativas inválidas de memória,
ficam no diretório ignorado
`packages/app/e2e/performance/results/consolidation/{baseline,after-initial,after}.json`.
Os logs originais desta execução ficam em `/var/tmp/redcode-consolidation/`.
Preserve os registros `BENCHMARK` completos em execuções futuras e mantenha dados
brutos fora do Git, conforme o guia de performance da aplicação.
