# LOCATION-006 — ativação de serviços de projeto

- Estado: `OBSERVED` para investigação; nenhum módulo Rust admitido ainda.
- Jornada: abertura e fechamento de projetos no backend.
- Evidência: `C:/Users/filip/artifacts/redcode-rust-study-2026-11-13/location-memory-breakdown.json`.

O benchmark executou quatro instâncias isoladas do plugin de catálogo e dois
ciclos de três projetos, com banco em memória, configuração temporária,
network fetch e watchers desativados. Na primeira ativação isolada do catálogo,
o heap após GC cresceu 11,05 MiB; nas três seguintes, entre 0,27 e 0,31 MiB
nessa etapa. Isso é consistente com estruturas compartilhadas, não com 11 MiB
por projeto para esse plugin.

Nos projetos completos, o heap retido cresceu 19,20 MiB no primeiro e 10,49 e
10,12 MiB nos seguintes. Nas seis criações dos dois ciclos, a janela entre
solicitar o serviço de plugins e concluir suas ativações variou de 5,41 a
11,34 MiB; a construção do contexto variou de 2,51 a 7,86 MiB. Os valores são
diferenças após GCs forçados em etapas sequenciais, incluem possível trabalho
assíncrono concorrente e não identificam individualmente um plugin. O cenário não
usa configurações reais de provedores e não explica sozinho o working set do
servidor empacotado.

Próxima decisão: atribuir a memória da ativação a componentes específicos em
uma carga representativa e comparar a alternativa TypeScript. Só definir uma
PoC Rust se um componente delimitado demonstrar custo e contrato adequados.

## Comparação inicial: índices dos roteadores

Uma instrumentação diagnóstica por plugin apontou `red-router` e `9router` como
candidatos. Ambos construíam mapas de nomes para o mesmo snapshot de catálogo em
cada projeto. A implementação agora compartilha os mapas imutáveis por identidade
do snapshot, usando `WeakMap`; um snapshot novo produz mapas novos, e os antigos
podem ser coletados quando não houver mais referências.

Na mesma fixture e com três projetos, antes os dois projetos adicionais retiveram
10,49 e 10,12 MiB; depois, 7,75 e 6,98 MiB. O primeiro projeto mudou de 19,20 para
17,81 MiB. As execuções são individuais e sequenciais, com GC explícito e sem
rede, watchers ou provedores conectados: são evidência inicial de ganho de heap,
não prova de economia equivalente no working set ou em produção. Os arquivos
`location-memory-breakdown.json` e `location-memory-shared-router.json` ficam no
diretório de artefatos indicado acima. O perfil por plugin altera o agendamento e
é usado apenas para escolher o candidato, não como valor exato de economia.
