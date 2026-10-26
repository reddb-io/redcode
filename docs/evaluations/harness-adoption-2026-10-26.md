# Primeiro lote do estudo de harnesses

Implementação local em `main`, sobre Redcode 0.86.0, a partir do
[estudo de 26/10](harness-upstream-2026-10-26.md). Há Changeset de patch;
este lote não foi commitado, publicado ou instalado e não reiniciou o servidor.

## Alterações

- Renovação OAuth compartilhada por credencial entre Locations, com lock entre
  processos, releitura após aquisição e timeout. Cancelar um solicitante preserva
  os demais; falhas compartilhadas permitem uma tentativa posterior. Contas salvas
  e configuração explícita de providers permanecem como autoridade.
- Photon em worker reutilizável, com liberação quando ocioso e substituição após
  crash ou cancelamento. As regras anteriores de tamanho, formato e qualidade
  foram mantidas. O fallback para processamento local continua disponível.
- O Step deixa de reter a cópia do evento do hook de request; a deduplicação de
  instruções consulta apenas mensagens sintéticas visíveis após a compactação.
- `session.settled` é uma observação efêmera: só segue uma execução bem-sucedida
  sem entrada promotável ou resultado de subagente pendente, inclusive descendentes.
  GUI/TUI usam essa observação para resposta pronta. Serviços de longa duração não
  bloqueiam o aviso, e interrupções deixam de anunciar sucesso na TUI.
- Cliente gerado oficialmente. Nenhum novo fato derivado foi acrescentado ao
  histórico durável, e o aceite de objetivos mantém suas barreiras atuais.

## Verificação

| Escopo                                                  | Resultado                               |
| ------------------------------------------------------- | --------------------------------------- |
| Core: quatro arquivos focados                           | 47 passaram                             |
| Core: nove arquivos de regressão, distintos dos focados | 396 passaram                            |
| Notificações TUI / GUI                                  | 10 / 2 passaram                         |
| Schema / Protocol / eventos compartilhados do Client    | 15 / 2 / 15 passaram                    |
| Lint e tipos completos                                  | 27/27 tarefas passaram                  |
| Geração do cliente                                      | Concluída                               |
| Worker de imagem compilado                              | Executado com worker real, sem fallback |
| CLI Linux x64                                           | Build completo e `--version` passaram   |
| GUI de produção                                         | Build passou                            |

A validação compilada detectou que uma entrada sob `src` mudava o caminho do
worker no executável. O build agora usa uma entrada virtual na raiz, ao lado dos
chunks compartilhados. O teste automatizado compila e executa o worker para
proteger essa integração; não se limita a testar os fontes.

## Benchmark da GUI

O cenário de entrada fria de sessão foi executado em produção, com backend de
fixture, um worker e três repetições por variante. Todos os nove cenários passaram.

| Variante                                 | Mediana até conteúdo correto | Mediana até estabilização |
| ---------------------------------------- | ---------------------------: | ------------------------: |
| Referência inicial                       |                     699,0 ms |                  773,5 ms |
| Implementação                            |                   1.909,3 ms |                1.922,1 ms |
| Controle posterior com listener anterior |                   1.406,5 ms |                1.489,8 ms |

O controle também ficou mais lento que a primeira referência. A máquina é
compartilhada e três amostras não isolam a causa dessa variação. Não afirmamos
ganho de desempenho nem descartamos uma regressão com esses números. Uma execução
anterior concorrente com typecheck foi excluída da comparação. Esse cenário mede
navegação da GUI, não latência do harness nem memória do processamento de imagens.

O código atual do listener foi restaurado byte a byte após o controle e a GUI foi
reconstruída. Não houve teste de notificações no servidor instalado do usuário.
Asserções de notificações são dos módulos reais com fixtures; o benchmark exercita
a navegação no navegador.

[Resultados estruturados e caminhos dos logs locais](harness-adoption-2026-10-26.json).
