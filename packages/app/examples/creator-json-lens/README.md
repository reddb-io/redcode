# JSON Lens · extensão visual do Creator

Um explorador de payloads instalado como componente persistente de um projeto no Redcode. Usa componentes reais do design system vendorizado: **KpiCard, BreakdownBar, JsonTree, Input, Textarea, Button, Badge e Alert**, com tema application e densidade compacta. O gráfico de composição tem 6 px; as métricas são calculadas do JSON editado.

## Usar no desktop

1. Abra uma conversa no projeto onde o componente foi instalado.
2. Clique em **Open Creator components** na barra da sessão.
3. Selecione **JSON Lens**. O controle **Expand to full width** amplia o painel.
4. Cole um documento em **Documento**, expanda os nós em **Estrutura** ou digite um JSON Pointer em **Consultar caminho**. Os atalhos abaixo do campo demonstram consultas.

`/customer/email` retorna `ana@example.com`; `/orders/0/total` retorna `149.9`. JSON inválido mostra o erro e desabilita a formatação; editar ou restaurar o exemplo recupera o painel. A árvore aceita navegação pelo teclado. O gráfico permite destacar um tipo.

Os dados iniciais são um exemplo editável, não telemetria do servidor. O documento editado fica apenas na memória do iframe e é restaurado ao recarregar. Não há rede, filesystem, credenciais ou comunicação com as ferramentas do JSON Inspector. É uma extensão visual isolada, não um plugin de execução no servidor.

## Construir e instalar pelo Creator

Da raiz do repositório:

```sh
bun packages/app/examples/creator-json-lens/build.ts
```

O resultado é um `component.html` portátil com código, estilos e fontes embutidos, por padrão em `<temp>/redcode-json-lens/build`. A compilação é uma etapa de desenvolvimento/Build. O Creator pode importar uma entrega HTML já construída com `design_preview` apontando para um diretório contendo `index.html`, definir seu contrato de artefato interativo e instalar a revisão usando `creator_component`. A instalação pede confirmação. Também é possível instalar pela interface **Creator components → Install component**.

Na demonstração real, o Creator publicou R1, solicitou permissão e instalou o painel. Após o refinamento de densidade, publicou R2 e atualizou a instalação com `expectedVersion: 1`. O servidor confirmou a versão 2 habilitada. Fonte e histórico de revisões permanecem no projeto de demonstração.

## Verificar a instalação real

Com o componente aberto no desktop de demonstração, passe seu endpoint CDP:

```sh
bun packages/app/examples/creator-json-lens/verify.ts http://127.0.0.1:9431
```

O verificador conecta ao renderer nativo `oc://renderer/index.html`, sem iniciar outro app ou simular APIs. Exercita métricas, consultas/escapes, erros, formatação, recuperação, árvore por teclado e seleção do gráfico; confirma o sandbox `allow-scripts` e a altura de 6 px. Salva screenshots e `verification.json` no diretório temporário do exemplo. Não encerra o app ao desconectar.

O explorador limita cada documento a 256 KiB e 64 níveis para manter a árvore responsiva. Esses limites pertencem somente a este exemplo visual. Não representam limites ou alertas de memória do Redcode.
