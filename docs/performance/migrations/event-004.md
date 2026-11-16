# EVENT-004 — serialização de eventos e histórico

- Estado: `REJECTED`
- Jornada: publicação, projeção e replay de eventos duráveis do backend
- Processos: server/Core; histórico persistente usa SQLite

## Decisão

Não iniciar PoC Rust. Não há profile que atribua custo material à codificação e o
caminho persistente está acoplado a Effect Schema, versionamento, transação SQLite,
projectors e replay. Uma fronteira nativa para serializar apenas o payload duplicaria
o contrato de schemas e ainda devolveria o mesmo objeto/JSON ao banco.

A inspeção encontrou trabalho evitável mais simples: o Bus executava
`Schema.encodeUnknownSync` para todo evento durável mesmo com `persist=false`,
embora o valor codificado só seja consumido por insert ou comparação de replay.
O encoding agora ocorre apenas dentro dos ramos persistentes. O comportamento de
projeção/live permanece igual e a suíte completa do Bus passou: 53 testes/97
asserts, cobrindo persistência, lotes, replay, versões, owners e paginação.

## Condição para reabrir

Reabrir somente se tracing separar tempo/bytes de schema encoding do custo de
SQLite e projectors em uma carga real persistente. Qualquer PoC deve preservar
versionamento e transforms de Effect Schema e medir a fronteira completa; trocar
`JSON.stringify` isoladamente não é suficiente.
