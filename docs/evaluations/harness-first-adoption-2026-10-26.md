# Primeira adoção: verificação com síntese e saída rápida de versão

Implementação local em `main`, sobre a base `0.86.0`, em 26/10/2026. Continua o
[estudo de single/dual e contexto](harness-reasoning-2026-10-26.md). As mudanças
anteriores de runtime permanecem no checkout e não foram removidas.

## Verificação restrita

O caminho `IntelligenceVerification` agora admite no máximo dois Steps:

1. Inspeção opcional com `read`, `glob`, `grep` e `session_history`, ou resposta direta que encerra a verificação.
2. Síntese dos resultados, sem ferramentas anunciadas e com execução de ferramentas recusada na fronteira, inclusive leituras. O request também declara `toolChoice: none`.

O estado deriva do marcador e das mensagens projetadas, inclusive fora da janela
recente. Retomar a sessão não repõe o allowance. Nova entrada humana promovida
substitui a verificação; resposta direta e erro de mensagem encerram o caminho.
Mantêm-se os limites de tokens por Step, budgets, permissões e execução durável
existentes. Falta de evidência não autoriza afirmar correção ou conclusão.

O caminho é distinto do self-review de código single e de seu allowance de até
quatro Steps. A alteração não liga S1 em single, não habilita flags experimentais
por conta própria e não configura providers.

Testes existentes foram alterados para exigir a síntese após uma leitura, saída
direta sem gasto extra e limite durável. Novo teste recusa ferramentas no Step
final. Antes da implementação, os três testes selecionados para o novo contrato
falhavam; depois, os sete testes focados passaram. A regressão completa de
controls, code-repair e session-runner passou: **282 testes, zero falhas**.

## `--version` e o relato no Windows

O relato do usuário é de aproximadamente cinco minutos para `redcode --version`
no PowerShell. Não houve acesso à máquina Windows nem reprodução dessa duração.

A inspeção encontrou um caminho desnecessário confirmado no código: o antigo
`packages/cli/src/index.ts` carregava a definição completa de comandos e montava
serviços de configuração, armazenamento, logs e observabilidade antes que o
parser tratasse `--version`. A aquisição de `Global` cria diretórios; o logger
também inicializa arquivos. A consulta de versão ficava sujeita a bloqueios desse
startup, mesmo sem iniciar a TUI ou uma sessão de agente.

O entrypoint agora contém somente aliases de ambiente, versão e despacho.
`--version` e `-v`, quando são o único argumento, imprimem a identificação
compatível (`redcode v<versão>` no build Redcode) e encerram sem importar o runtime
da CLI. A inicialização anterior foi preservada em `src/main.ts`. O modo SSH
askpass mantém seu despacho anterior. Combinações de argumentos continuam sob o
parser completo.

O teste de subprocesso executa os entrypoints OpenCode e Redcode com ambas as
flags, diretório corrente isolado e configuração apontando para um arquivo onde
seria necessário um diretório. Exige saída/exit code corretos e ausência de
estado/logs novos. O cache do transpiler Bun é desabilitado somente no fixture,
para distinguir I/O do interpretador de I/O da aplicação.

A regressão de versão, upgrade e flags de reasoning passou: **14 testes, zero
falhas**. O teste de versão foi repetido depois do ajuste de compatibilidade do
prefixo: **1 teste, 8 assertions, zero falhas**. Está registrado na suíte de
contratos de produto, executada também no Windows pelo workflow existente.

O build oficial Linux x64 também passou. No executável de 257.988.784 bytes,
cinco subprocessos com `--version`/`-v` responderam em 453,72 / 73,90 / 83,04 /
53,57 / 94,00 ms; mediana de **83,04 ms**. A primeira chamada é listada
separadamente, sem afirmar que o cache do sistema estava frio. Todas ignoraram
a configuração inválida sem criar estado. `--help` e `__design-app --version`
também passaram, verificando o despacho preservado. São medições neste host
Linux compartilhado, sem baseline de desempenho e sem equivalência com Windows.
Resultado: `/tmp/redcode-version-smoke-20261026.json`.

`bun run check` passou na raiz: **27 tarefas bem-sucedidas**, 20 em cache,
em 6 min 15 s. O teste do auxiliar SSH também passou (1 teste, 4 assertions).
O diretório temporário do build foi removido depois do smoke; os logs e o JSON
de medição foram preservados. Não houve verificação em um runtime Windows.

### O que ainda precisa ser discriminado no Windows

| Camada                             | Evidência disponível                                                                                                                          | Como discriminar                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Resolução pelo PowerShell          | Ainda não sabemos se é `.ps1`, `.cmd`, `.exe`, função ou shim de ferramenta                                                                   | `Get-Command redcode -All`                                                             |
| Launcher npm                       | O postinstall atual gera shims que chamam o executável nativo diretamente; o launcher genérico faz sondagem de CPU com subprocessos limitados | Identificar o arquivo realmente selecionado, depois comparar com seu executável nativo |
| Carregamento do executável/runtime | O build usa Bun e certificados do sistema; custo na máquina não foi medido                                                                    | Comparar execução direta do mesmo `.exe`, primeira chamada e repetição                 |
| Inicialização da aplicação         | Confirmado que era feita antes da saída de versão                                                                                             | Novo caminho evita essa inicialização; validar depois no Windows afetado               |

Há também um candidato específico para um atraso de exatamente cinco minutos:
`src/ssh-askpass.ts` usa esse timeout. A presença de `OPENCODE_SSH_ASKPASS_PORT`
(ou seu alias Redcode) seleciona esse modo antes do parser normal. A variável é
prevista para processos auxiliares de SSH; sua presença no PowerShell do usuário
ainda não foi verificada. O novo despacho preserva esse modo, em vez de alterar
o protocolo de senha SSH por hipótese.

Não há evidência para atribuir os cinco minutos a antivírus, PowerShell, provider,
rede, lock ou certificados. A correção elimina um caminho de bloqueio da
aplicação, mas não comprova a resolução do incidente específico do Windows.

Foi solicitado ao usuário o resultado que já apareceu, a frequência do atraso e
esta identificação, que não exige repetir a chamada lenta:

```powershell
Get-Command redcode -All | Select-Object CommandType, Source, Path | Format-List
```

Também foi solicitada apenas a presença das variáveis, sem imprimir valores:

```powershell
[bool]$env:OPENCODE_SSH_ASKPASS_PORT
[bool]$env:REDCODE_SSH_ASKPASS_PORT
```

Nenhum serviço instalado foi reiniciado, configuração de Windows alterada ou
controle de segurança desabilitado. O estudo upstream complementar não trouxe
uma reprodução equivalente que permita fechar a causa neste momento.

## Continuação do plano

Esta etapa implementa a inspeção/síntese e corrige o caminho desnecessário de
versão. A visão comum de pedido vigente/evidências, sua adoção nos avaliadores e
as melhorias de preservação na compactação continuam como próximas etapas do
plano. Este lote não representa a implementação completa dessas propostas.

Logs locais:

- `/tmp/redcode-verification-two-step-before.log`
- `/tmp/redcode-verification-two-step-after.log`
- `/tmp/redcode-verification-regressions-20261026.log`
- `/tmp/redcode-version-regressions-20261026.log`
- `/tmp/redcode-version-after.log`
- `/tmp/redcode-harness-startup-check-20261026.log`

Os Changesets `verification-synthesis.md` e `cli-version-startup.md` registram o
comportamento visível. As alterações permanecem locais, sem publicação.
