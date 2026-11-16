# PATCH-002 — parsing e normalização de patches

- Estado: `REJECTED`
- Revisão: working tree de 2026-11-13, hashes preservados pelo Git
- Plataforma: Windows x64, Bun 1.4.4, Ryzen 5 3600
- Jornada: status/diff do VCS e aplicação do tool de patch
- Artefatos: `patch-002-baseline.json` e `patch-002-typescript-streaming.json`

## Decisão

Não iniciar uma PoC Rust. A hipótese não apareceu em profile real e o limite de
entrada já é 10 MB. Nesse teto sintético, mapear todo o diff por arquivo custou
32,80 ms na primeira coleta; aplicar um hunk a um arquivo de 10 MB custou 26,67 ms
e aproximadamente 32 MiB temporários. Uma fronteira Rust teria de receber e
devolver payloads da mesma ordem, reduzindo o ganho líquido e ampliando contrato,
empacotamento e risco de paridade.

A oportunidade óbvia era `countPatch` usar `split("\n")`, materializando um array
do diff inteiro. A varredura TypeScript sem alocação intermediária reduziu a
mediana de RSS incremental de 9,36 MiB para zero e a parede de 18,09 para 16,78 ms
no diff de 10 MB. Casos de headers, linha final sem newline e entrada vazia ficaram
cobertos por teste.

## Condição para reabrir

Reabrir somente se profiling de produção atribuir long tasks ou retenção material
a `chunksByFile`, `Patch.parse` ou `Patch.derive` em carga representativa. Uma nova
hipótese deve comparar primeiro parsing incremental em TypeScript e contabilizar
os bytes copiados pela FFI. Até lá, o ganho disponível não justifica um backend
nativo.
