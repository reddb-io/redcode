# TOOL-SCHEMA-009 — conversão dos schemas das ferramentas

- Estado: `REJECTED` para reescrita Rust; otimização TypeScript no caminho padrão.
- Jornada: ativação de ferramentas ao abrir projetos no backend.
- Contrato: JSON Schema funcionalmente idêntico para entradas e saídas,
  incluindo referências, recursão e restrições; os resultados de chamadas
  diferentes devem poder ser alterados independentemente.
- Meta: reduzir em pelo menos 20% o tempo acumulado de `definition` na fixture
  de cinco projetos, preservando o contrato e sem retenção global ilimitada.

Em uma execução isolada instrumentada, `definition` foi chamada 920 vezes e
levou 179,71 ms acumulados; 684 entradas reutilizaram objetos Effect Schema já
vistos. A captura é uma triagem de um único processo, com providers sem acesso e
watchers desligados. O primeiro ensaio com instrumentação incompleta é inválido;
o baseline válido é `tool-schema-profile-corrected.json` em
`C:/Users/filip/artifacts/redcode-rust-study-2026-11-13/`.

A hipótese é guardar a conversão por identidade do Effect Schema em `WeakMap`
e devolver cópias independentes. Standard Schema e JSON Schema externos não
entram no cache sem contrato de imutabilidade. Mediremos o custo de cópia na
comparação e testaremos mutação, referências e schemas distintos.

Na PoC, o mesmo contador mediu 122,93 ms contra 179,71 ms no baseline; uma
comparação de heap após GC em três projetos mostrou 145,16 MiB contra 144,54 MiB
antes. Essas medições são ensaios individuais, não resultado de produção.

Na suíte de integração, duas expectativas desatualizadas também falhavam no
baseline: a validação consulta o Standard JSON Schema na execução e campos
desconhecidos são preservados para rejeição explícita, não descartados. Os
testes foram ajustados para verificar esses comportamentos sem mudá-los. Com
o cache, 84 testes de schema, registro, execução e reparo passaram, incluindo
a independência entre as cópias devolvidas.

Uma repetição sequencial mediu 198,25 ms antes e 136,56 ms depois para as 920
definições, redução de 31,1% nessa amostra. O resultado satisfaz a meta da
fixture, sem equivaler a uma medição de abertura de produção. O cache guarda
apenas conversões de Effect Schema, usa chaves fracas e devolve cópias. Não foi
necessária uma PoC Rust. Os relatórios `tool-schema-baseline-repeat.json`,
`tool-schema-cached-repeat.json` e `tool-schema-memory-cached.json` ficam no
diretório de artefatos indicado acima.
