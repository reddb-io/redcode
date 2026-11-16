# AZURE-007 — detecção do Azure CLI por projeto

- Estado: `REJECTED` para a substituição direta por `Bun.which`.
- Jornada: abertura de projetos no backend, antes de apresentar métodos de autenticação.
- Contrato: informar se o executável `az` está no PATH sem iniciá-lo, preservar
  a seleção explícita de credenciais e atualizar a detecção em novos projetos.
- Meta: reduzir pelo menos 20% do p95 da detecção, sem alterar disponibilidade
  do método Azure CLI ou os testes de autenticação. Outras plataformas precisam
  manter o comportamento existente.

Um perfil diagnóstico Windows do boot de cinco projetos atribuiu amostras à
busca síncrona de `az` pelo pacote `which`. Em 30 comparações alternadas de uma
busca de `az` ausente no PATH real, o p95 foi 153,96 ms com o código atual e
24,82 ms com `Bun.which`; as duas alternativas retornaram o mesmo resultado.
O ensaio não inicia o executável e é uma amostra de um ambiente, não um ganho
medido de abertura completa. Ao testar a substituição direta, o caso instalado
com `az.cmd` no PATH não foi detectado e três dos 14 testes falharam. A mudança
foi revertida; a implementação existente continua sendo a selecionada. Reabrir
somente com uma alternativa que preserve a resolução Windows e demonstre o
ganho sem executar o Azure CLI ou alterar credenciais.
