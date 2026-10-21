# Evidências e reproduções da revisão

- `evidence.json`: consultas, limites da amostra, referências imutáveis e fontes.
- `measurements.json`: execuções curtas concluídas, execução inicial substituída
  e snapshot da execução contínua ainda pendente.
- `run-probes.py` e `probes.template.ts`: harness de pesquisa, sem mudança de runtime.

Requer dependências instaladas no checkout, Bun e Python 3. O runner cria um
diretório temporário com resolução das dependências do TUI, substitui a raiz
do checkout no template e executa os probes **a partir de packages/tui**.
Use diretórios de saída novos para preservar execuções anteriores.

Da raiz do repositório:

```sh
python3 docs/evaluations/upstream-review-2026-10-07/run-probes.py --output /tmp/redcode-review-short
```

O teste de 10.000 steps pode ocupar um core por mais de um minuto. É um burst
artificial de 60.000 eventos, não um modelo de cadência normal do provider.
Os asserts de retenção/JSON registram defeitos existentes: passar não significa
que o produto foi corrigido. Nenhuma ferramenta é despachada pelo probe de JSON.

Para uma medição comparável de RSS, isolar cada caso em um processo:

```sh
python3 docs/evaluations/upstream-review-2026-10-07/run-probes.py --output /tmp/redcode-review-10000 --filter 'loaded history 10000 at width 112'
```

Execução contínua de 24 horas, somente o caso temporal:

```sh
python3 docs/evaluations/upstream-review-2026-10-07/run-probes.py --output /tmp/redcode-review-24h --soak-seconds 86400 --filter 'continuous production'
```

O processo precisa permanecer vivo por 24 horas. `execution.json` registra início,
PID, checkout e estado; `output.log` contém amostras durante a execução. Ao
terminar, conferir `status: completed`, `exit_code: 0` e a medição `soak-finished`
em `measurements.json`. Interrupção, morte do processo ou reboot podem deixar
`status: running` obsoleto: verificar o PID antes de interpretar esse estado.

A execução iniciada nesta revisão usa `/tmp/redcode-upstream-final-yup901pt/soak-24h`.
Não iniciar uma segunda cópia apenas para consultar o resultado. O template
foi ampliado depois do início; o hash e a cópia original dessa execução estão
indicados no snapshot, preservando a identidade do harness efetivamente usado.

O harness não se conecta ao serviço gerenciado: usa portas loopback efêmeras,
armazenamento temporário e renderer de teste com componentes de produção. Não
executa modelo pago, não submete prompts reais e não simula suspensão do sistema.
Eventos de atividade substituem a necessidade de keepalive durante o soak.
O tempo de teclado inclui a sondagem de frames do renderer de teste. Consumo
de memória inclui a fixture e não deve ser tratado como heap exclusivo do TUI.
